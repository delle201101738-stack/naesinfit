import { sql, ensure, checkPin } from "./_db.js";

export default async function handler(req, res) {
  const gate = checkPin(req);
  if (!gate.ok) {
    return res.status(401).json({
      error: gate.why === "NO_PIN"
        ? "선생님 비밀번호(TEACHER_PIN)가 아직 설정되지 않았습니다"
        : "비밀번호가 맞지 않습니다"
    });
  }
  try {
    await ensure();
    const rows = await sql`
      select id, student, book, part, part_name, scope, total, correct, pct, secs, detail, created_at
      from attempts order by created_at desc limit 2000`;
    res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error("[results]", e);
    res.status(500).json({ error: "불러오지 못했습니다" });
  }
}
