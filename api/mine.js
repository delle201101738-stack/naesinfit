// 학생 본인 기록 조회 — 이름으로만 조회합니다(비밀번호 없음).
import { sql, ensure } from "./_db.js";

export default async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://x");
    const student = (u.searchParams.get("student") || "").trim().slice(0, 20);
    const id = u.searchParams.get("id");
    if (!student) return res.status(400).json({ error: "이름이 없습니다" });
    await ensure();
    res.setHeader("Cache-Control", "no-store");

    if (id) {
      const [row] = await sql`
        select id, book, part, part_name, scope, total, correct, pct, secs, detail, created_at
        from attempts where id = ${Number(id)} and student = ${student} limit 1`;
      return res.status(200).json({ ok: true, row: row || null });
    }
    const rows = await sql`
      select id, book, part, part_name, scope, total, correct, pct, secs, created_at
      from attempts where student = ${student}
      order by created_at desc limit 300`;
    res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error("[mine]", e);
    res.status(500).json({ error: "기록을 불러오지 못했습니다" });
  }
}
