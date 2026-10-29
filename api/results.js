import { sql, ensure, checkPin, pinError } from "./_db.js";

export default async function handler(req, res) {
  const gate = await checkPin(req).catch(() => ({ ok: false, why: "ERR" }));
  if (!gate.ok) return res.status(gate.why === "ERR" ? 500 : 401).json({ error: gate.why === "ERR" ? "잠시 후 다시 해 주세요" : pinError(gate) });
  try {
    await ensure();
    const rows = await sql`
      select id, student, book, unit_id, part, part_name, scope, total, correct, pct, secs, detail, created_at
      from attempts order by created_at desc limit 2000`;
    res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error("[results]", e);
    res.status(500).json({ error: "불러오지 못했습니다" });
  }
}
