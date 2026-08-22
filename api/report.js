// 리포트용 집계 — 학생 본인 기록 + 전체 반평균 + 반복 오답
import { sql, ensure } from "./_db.js";

export default async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://x");
    const student = (u.searchParams.get("student") || "").trim().slice(0, 20);
    if (!student) return res.status(400).json({ error: "이름이 없습니다" });
    await ensure();
    res.setHeader("Cache-Control", "no-store");

    const rows = await sql`
      select id, book, part, part_name, scope, total, correct, pct, secs, created_at
      from attempts where student = ${student}
      order by created_at asc limit 500`;

    if (!rows.length) return res.status(200).json({ ok: true, rows: [], cls: [], wrong: [], days: 0 });

    // 전체 학생 평균(반평균) — 교재·파트별
    const cls = await sql`
      select book, part, part_name,
             sum(total)::int as t, sum(correct)::int as c,
             count(*)::int as n, count(distinct student)::int as s
      from attempts group by book, part, part_name`;

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

    const days = new Set(rows.map(r => new Date(r.created_at).toISOString().slice(0, 10))).size;
    res.status(200).json({ ok: true, student, rows, cls, wrong, days });
  } catch (e) {
    console.error("[report]", e);
    res.status(500).json({ error: "리포트를 만들지 못했습니다" });
  }
}
