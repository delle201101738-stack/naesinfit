import { sql, ensure, readBody } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 받습니다" });
  try {
    const b = await readBody(req);
    const student = String(b.student || "").trim().slice(0, 20);
    if (!student) return res.status(400).json({ error: "이름이 없습니다" });
    const num = (v, d = 0) => (Number.isFinite(+v) ? Math.round(+v) : d);

    await ensure();
    const [row] = await sql`
      insert into attempts (student, book, part, part_name, scope, total, correct, pct, secs, detail)
      values (${student}, ${String(b.book || "영어II 천재(강상구) 1과").slice(0, 80)},
              ${String(b.part || "").slice(0, 20)}, ${String(b.partName || "").slice(0, 40)},
              ${String(b.scope || "all").slice(0, 20)},
              ${num(b.total)}, ${num(b.correct)}, ${num(b.pct)}, ${num(b.secs)},
              ${JSON.stringify(b.detail || [])}::jsonb)
      returning id, created_at`;
    res.status(200).json({ ok: true, id: row.id, at: row.created_at });
  } catch (e) {
    const msg = e?.message === "NO_DB"
      ? "데이터베이스가 아직 연결되지 않았습니다 (Vercel Storage에서 Postgres를 붙여 주세요)"
      : "저장에 실패했습니다";
    console.error("[submit]", e);
    res.status(500).json({ error: msg });
  }
}
