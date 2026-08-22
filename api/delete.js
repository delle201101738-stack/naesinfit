import { sql, ensure, checkPin, readBody } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 받습니다" });
  const gate = checkPin(req);
  if (!gate.ok) return res.status(401).json({ error: "비밀번호가 맞지 않습니다" });
  try {
    const b = await readBody(req);
    await ensure();
    if (b.id) await sql`delete from attempts where id = ${Number(b.id)}`;
    else if (b.student) await sql`delete from attempts where student = ${String(b.student)}`;
    else return res.status(400).json({ error: "지울 대상이 없습니다" });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[delete]", e);
    res.status(500).json({ error: "삭제하지 못했습니다" });
  }
}
