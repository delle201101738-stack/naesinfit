// 학생 앱: 반 목록 보기 + 내 반 등록 (비밀번호 없이) — 이름·반이 숙제 검사와 정확히 연결되도록
import { sql, ensure, readBody } from "./_db.js";

export default async function handler(req, res) {
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const classes = await sql`select id, name from hw_classes order by name`;
      return res.status(200).json({ ok: true, classes });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });
    const b = await readBody(req);
    const student = String(b.student || "").trim().slice(0, 20);
    const cid = Number(b.class_id) || 0, prev = Number(b.prev_class_id) || 0;
    if (!student || !cid) return res.status(400).json({ error: "이름과 반을 골라 주세요" });
    const [c] = await sql`select id, name from hw_classes where id = ${cid}`;
    if (!c) return res.status(404).json({ error: "없는 반입니다. 새로고침 후 다시 골라 주세요" });
    if (prev && prev !== cid) await sql`delete from hw_members where class_id = ${prev} and student = ${student}`;
    await sql`insert into hw_members (class_id, student) values (${cid}, ${student}) on conflict do nothing`;
    const other = await sql`select c.name from hw_members m join hw_classes c on c.id = m.class_id
                            where m.student = ${student} and m.class_id <> ${cid}`;
    res.status(200).json({ ok: true, class: c, others: other.map(r => r.name) });
  } catch (e) {
    console.error("[join]", e);
    res.status(500).json({ error: "반 등록에 실패했습니다" });
  }
}
