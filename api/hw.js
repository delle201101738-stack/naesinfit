// 반 · 숙제 관리 (선생님 비밀번호 필요) — 시험 기록과 별개
import { sql, ensure, readBody, checkPin, pinError, tokenFor } from "./_db.js";

const S = (v, n) => String(v ?? "").trim().slice(0, n);
const DAY = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const STATUS = new Set(["done", "part", "none", "skip"]);

async function snapshot() {
  const [classes, members, items, checks, students, views] = await Promise.all([
    sql`select id, name, created_at, exam_date, exam_name from hw_classes order by right(name, 1), name`,
    sql`select class_id, student, focus from hw_members order by student`,
    sql`select id, class_id, day, title, memo, created_at from hw_items order by day desc, id desc limit 1500`,
    sql`select item_id, student, status, score, memo, checked_at from hw_checks`,
    sql`select student, count(*)::int as n, max(created_at) as last, max(class_name) as cls from attempts group by student order by student`,
    sql`select student, day, first_at, last_at, n from report_views where last_at > now() - interval '60 days'`
  ]);
  return { ok: true, classes, members, items, checks, students: students.map(r => r.student), stu: students, views };
}

export default async function handler(req, res) {
  const gate = await checkPin(req).catch(() => ({ ok: false, why: "ERR" }));
  if (!gate.ok) return res.status(gate.why === "ERR" ? 500 : 401).json({ error: gate.why === "ERR" ? "잠시 후 다시 해 주세요" : pinError(gate) });
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json(await snapshot());
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });

    const b = await readBody(req);
    const id = Number(b.id) || 0;
    switch (b.action) {
      case "class.create": {
        const name = S(b.name, 40); if (!name) return res.status(400).json({ error: "반 이름이 없습니다" });
        const [r] = await sql`insert into hw_classes (name) values (${name}) returning id`;
        return res.status(200).json({ ok: true, id: r.id });
      }
      case "class.rename": {
        const name = S(b.name, 40); if (!id || !name) return res.status(400).json({ error: "반 이름이 없습니다" });
        await sql`update hw_classes set name = ${name} where id = ${id}`; break;
      }
      case "class.delete": {
        if (!id) return res.status(400).json({ error: "반이 없습니다" });
        await sql`delete from hw_checks where item_id in (select id from hw_items where class_id = ${id})`;
        await sql`delete from hw_items where class_id = ${id}`;
        await sql`delete from hw_members where class_id = ${id}`;
        await sql`delete from hw_classes where id = ${id}`; break;
      }
      case "members.set": {
        const cid = Number(b.class_id) || 0; if (!cid) return res.status(400).json({ error: "반이 없습니다" });
        const list = [...new Set((Array.isArray(b.students) ? b.students : []).map(x => S(x, 20)).filter(Boolean))].slice(0, 200);
        await sql`delete from hw_members where class_id = ${cid} and not (student = any(${list}))`;
        for (const st of list) await sql`insert into hw_members (class_id, student) values (${cid}, ${st}) on conflict do nothing`;
        break;
      }
      case "item.create": {
        const cid = Number(b.class_id) || 0, day = DAY(b.day), title = S(b.title, 120);
        if (!cid || !day || !title) return res.status(400).json({ error: "반·날짜·숙제 내용을 모두 넣어 주세요" });
        const [r] = await sql`insert into hw_items (class_id, day, title, memo) values (${cid}, ${day}, ${title}, ${S(b.memo, 600)}) returning id`;
        return res.status(200).json({ ok: true, id: r.id });
      }
      case "item.update": {
        const day = DAY(b.day), title = S(b.title, 120);
        if (!id || !day || !title) return res.status(400).json({ error: "날짜·숙제 내용을 넣어 주세요" });
        await sql`update hw_items set day = ${day}, title = ${title}, memo = ${S(b.memo, 600)} where id = ${id}`; break;
      }
      case "item.delete": {
        if (!id) return res.status(400).json({ error: "숙제가 없습니다" });
        await sql`delete from hw_checks where item_id = ${id}`;
        await sql`delete from hw_items where id = ${id}`; break;
      }
      case "check.set": {
        const iid = Number(b.item_id) || 0, st = S(b.student, 20), status = S(b.status, 8);
        if (!iid || !st) return res.status(400).json({ error: "숙제·학생이 없습니다" });
        if (!STATUS.has(status)) { await sql`delete from hw_checks where item_id = ${iid} and student = ${st}`; break; }
        const sc = b.score === "" || b.score == null || !Number.isFinite(+b.score) ? null : Math.max(0, Math.min(100, Math.round(+b.score)));
        await sql`insert into hw_checks (item_id, student, status, score, memo, checked_at)
                  values (${iid}, ${st}, ${status}, ${sc}, ${S(b.memo, 300)}, now())
                  on conflict (item_id, student) do update
                  set status = excluded.status, score = excluded.score, memo = excluded.memo, checked_at = now()`;
        break;
      }
      case "member.focus": {    // ★ 집중관리 학생 · 사유 (비우면 해제)
        const cid = Number(b.class_id) || 0, st = S(b.student, 20);
        if (!cid || !st) return res.status(400).json({ error: "반·학생이 없습니다" });
        await sql`update hw_members set focus = ${S(b.focus, 80)} where class_id = ${cid} and student = ${st}`; break;
      }
      case "class.exam": {   // 반 내신 시험 날짜 (리포트 D-day)
        if (!id) return res.status(400).json({ error: "반이 없습니다" });
        await sql`update hw_classes set exam_date = ${DAY(b.exam_date) || ""}, exam_name = ${S(b.exam_name, 40)} where id = ${id}`; break;
      }
      case "tokens.get": {   // 학부모에게 보낼 비공개 링크 토큰
        const list = [...new Set((Array.isArray(b.students) ? b.students : []).map(x => S(x, 20)).filter(Boolean))].slice(0, 300);
        return res.status(200).json({ ok: true, tokens: await tokenFor(list) });
      }
      case "note.set": {     // 선생님 코멘트 · 한마디 저장 (학부모 링크에 그대로 나감)
        const st = S(b.student, 20), day = DAY(b.day), kind = ["day", "week", "month"].includes(b.kind) ? b.kind : "day";
        if (!st || !day) return res.status(400).json({ error: "학생·날짜가 없습니다" });
        await sql`insert into report_notes (student, day, kind, headline, note, updated_at)
                  values (${st}, ${day}, ${kind}, ${S(b.headline, 200)}, ${String(b.note || "").slice(0, 4000)}, now())
                  on conflict (student, day, kind) do update set headline = excluded.headline, note = excluded.note, updated_at = now()`;
        break;
      }
      case "student.merge": {   // 이름 정리: from 이름의 모든 기록을 to 이름으로 (동명이인은 선생님이 고를 때만)
        const from = S(b.from, 20), to = S(b.to, 20);
        if (!from || !to || from === to) return res.status(400).json({ error: "합칠 이름을 골라 주세요" });
        const a = await sql`update attempts set student = ${to} where student = ${from} returning id`;
        await sql`delete from hw_checks k where k.student = ${from} and exists (select 1 from hw_checks k2 where k2.item_id = k.item_id and k2.student = ${to})`;
        await sql`update hw_checks set student = ${to} where student = ${from}`;
        await sql`delete from report_notes n where n.student = ${from} and exists (select 1 from report_notes n2 where n2.student = ${to} and n2.day = n.day and n2.kind = n.kind)`;
        await sql`update report_notes set student = ${to} where student = ${from}`;
        await sql`delete from report_views v where v.student = ${from} and exists (select 1 from report_views v2 where v2.student = ${to} and v2.day = v.day)`;
        await sql`update report_views set student = ${to} where student = ${from}`;
        await sql`delete from report_tokens where student = ${from}`;
        await sql`delete from hw_members m where m.student = ${from} and exists (select 1 from hw_members m2 where m2.class_id = m.class_id and m2.student = ${to})`;
        await sql`update hw_members set student = ${to} where student = ${from}`;
        return res.status(200).json({ ok: true, moved: a.length });
      }
      case "export": {          // 엑셀 백업용 전체 자료
        const [cl, mem, it, ck, at, nt, vw] = await Promise.all([
          sql`select id, name, exam_date, exam_name, created_at from hw_classes order by id`,
          sql`select c.name as class_name, m.student from hw_members m join hw_classes c on c.id = m.class_id order by c.name, m.student`,
          sql`select i.id, c.name as class_name, i.day, i.title, i.memo from hw_items i join hw_classes c on c.id = i.class_id order by i.day, i.id`,
          sql`select k.item_id, i.day, c.name as class_name, i.title, k.student, k.status, k.score, k.memo, k.checked_at
              from hw_checks k join hw_items i on i.id = k.item_id join hw_classes c on c.id = i.class_id order by i.day, c.name, k.student`,
          sql`select id, student, class_name, book, unit_id, part, part_name, scope, total, correct, pct, secs, created_at from attempts order by created_at limit 50000`,
          sql`select student, day, kind, headline, note, updated_at from report_notes order by day, student`,
          sql`select student, day, first_at, last_at, n from report_views order by day, student`
        ]);
        return res.status(200).json({ ok: true, classes: cl, members: mem, items: it, checks: ck, attempts: at, notes: nt, views: vw });
      }
      default: return res.status(400).json({ error: "알 수 없는 요청입니다" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[hw]", e);
    res.status(500).json({ error: "숙제 정보를 저장하지 못했습니다" });
  }
}
