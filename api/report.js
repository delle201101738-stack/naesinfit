// 리포트용 집계 — 학생 본인 기록 + 전체 반평균 + 반복 오답
import { sql, ensure, checkPin } from "./_db.js";

export default async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://x");
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    // 학부모 = 비공개 링크 토큰(t)으로만, 선생님 = 비밀번호(x-pin)로 이름 조회
    const tok = (u.searchParams.get("t") || "").trim().slice(0, 40);
    let student = "", teacher = false;
    if (tok) {
      const [r] = await sql`select student from report_tokens where token = ${tok}`;
      if (!r) return res.status(404).json({ error: "리포트 링크가 올바르지 않아요. 선생님께 새 링크를 받아 주세요." });
      student = r.student;
    } else {
      const g = await checkPin(req);
      if (!g.ok) return res.status(401).json({ error: g.why === "LOCKED" ? pinError(g) : "선생님 비밀번호가 필요해요 (학부모님은 선생님이 보내 준 링크로 열어 주세요)" });
      student = (u.searchParams.get("student") || "").trim().slice(0, 20); teacher = true;
      if (!student) return res.status(400).json({ error: "이름이 없습니다" });
    }

    // ?day=YYYY-MM-DD → 그날 채점한 모든 칸(맞음·틀림) — 영역별(어법·어휘·독해) 분석용
    const day = (u.searchParams.get("day") || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const items = await sql`
        select a.id, a.book, a.unit_id, a.part, a.part_name, a.scope,
               it->>'sec' as sec, it->>'no' as no,
               d->>'l' as l, (d->>'ok') as ok, d->>'m' as m, d->>'r' as r, d->>'t' as t
        from attempts a,
             jsonb_array_elements(a.detail) it,
             jsonb_array_elements(it->'d') d
        where a.student = ${student}
          and to_char(a.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') = ${day}
        limit 8000`;
      return res.status(200).json({ ok: true, day, items });
    }

    // 학부모가 링크를 열었는지 (선생님 화면에 👀 표시) — 브라우저에서 실제로 연 경우만 (카톡 미리보기 봇은 JS를 안 돌림)
    if (tok && u.searchParams.get("nv") !== "1") {
      const vd = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get("vd") || "") ? u.searchParams.get("vd")
        : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      await sql`insert into report_views (student, day) values (${student}, ${vd})
                on conflict (student, day) do update set last_at = now(), n = report_views.n + 1`.catch(() => {});
    }

    const rows = (await sql`
      select id, book, unit_id, part, part_name, scope, total, correct, pct, secs, created_at
      from attempts where student = ${student}
      order by created_at desc limit 1000`).reverse();

    // 숙제 검사 기록 — 학생이 속한 반의 숙제 + 검사 결과 + 반 완료율
    const hw = await sql`
      select i.id, i.day, i.title, i.memo, c.name as class_name,
             k.status, k.score, k.memo as cmemo,
             (select count(*)::int from hw_members m2 where m2.class_id = i.class_id) as n,
             (select count(*)::int from hw_checks k2 where k2.item_id = i.id and k2.status = 'done') as nd,
             (select count(*)::int from hw_checks k3 where k3.item_id = i.id and k3.status <> 'skip') as nc
      from hw_members m
      join hw_items i on i.class_id = m.class_id
      join hw_classes c on c.id = m.class_id
      left join hw_checks k on k.item_id = i.id and k.student = m.student
      where m.student = ${student}
      order by i.day desc, i.id asc
      limit 120`;

    const notes = await sql`select day, kind, headline, note, updated_at from report_notes where student = ${student}`;
    const klass = await sql`select c.id, c.name, c.exam_date, c.exam_name from hw_members m join hw_classes c on c.id = m.class_id where m.student = ${student}`;
    const extra = { notes, klass, teacher };

    if (!rows.length) return res.status(200).json({ ok: true, student, rows: [], cls: [], wrong: [], hw, days: 0, ...extra });

    // 전체 학생 평균(반평균) — 교재·파트별
    // 반평균 — 같은 교재(과)·같은 시험(파트)·같은 날(한국 시간) 본 학생들, 학생마다 그날 최고 기록 1개씩 (재시험 제외)
    const books = [...new Set(rows.map(r => r.book))];
    const cls = await sql`
      with x as (
        select student, book, part, total, correct,
               to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day
        from attempts
        where scope <> '재시험' and total > 0 and book = any(${books})
      ), b as (
        select distinct on (student, book, part, day) student, book, part, day, total, correct
        from x
        order by student, book, part, day, (correct::float / total) desc
      )
      select book, part, day, sum(total)::int as t, sum(correct)::int as c,
             count(*)::int as s, round(avg(correct * 100.0 / total))::int as p
      from b group by book, part, day`;

    // 반복 오답 — 같은 자리에서 여러 번 틀린 것
    const wrong = await sql`
      select a.book, a.part_name,
             it->>'sec' as sec, it->>'no' as no,
             d->>'l' as label, d->>'m' as mine, d->>'r' as right_,
             count(*)::int as cnt
      from attempts a,
           jsonb_array_elements(a.detail) it,
           jsonb_array_elements(it->'d') d
      where a.student = ${student} and (d->>'ok') = '0'
      group by a.book, a.part_name, it->>'sec', it->>'no', d->>'l', d->>'m', d->>'r'
      order by cnt desc, a.book
      limit 40`;

    // 날짜별 틀린 자리 — 그날 리포트의 강점·약점 분석용 (한국 시간 기준 날짜)
    const dwrong = await sql`
      select a.book, a.part, a.part_name, a.scope,
             to_char(a.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day,
             it->>'sec' as sec, it->>'no' as no,
             d->>'l' as label, d->>'m' as mine, d->>'r' as right_
      from attempts a,
           jsonb_array_elements(a.detail) it,
           jsonb_array_elements(it->'d') d
      where a.student = ${student} and (d->>'ok') = '0'
      order by a.created_at desc
      limit 1500`;

    const days = new Set(rows.map(r => new Date(r.created_at).toISOString().slice(0, 10))).size;
    res.status(200).json({ ok: true, student, rows, cls, wrong, dwrong, hw, days, ...extra });
  } catch (e) {
    console.error("[report]", e);
    res.status(500).json({ error: "리포트를 만들지 못했습니다" });
  }
}
