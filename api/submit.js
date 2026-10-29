import { sql, ensure, readBody } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 받습니다" });
  try {
    const b = await readBody(req);
    const student = String(b.student || "").trim().slice(0, 20);
    if (!student) return res.status(400).json({ error: "이름이 없습니다" });
    const num = (v, d = 0) => (Number.isFinite(+v) ? Math.round(+v) : d);

    await ensure();
    // 예전 앱(반 고르기 전)에서 구분자 없이 보낸 이름 → 명단 이름으로 (명단에 그 이름이 하나뿐일 때만)
    // 동명이인이 있으면 학생이 고른 반(className)으로 구분
    let stu = student;
    const exact = await sql`select 1 from hw_members where student = ${stu} limit 1`;
    if (!exact.length && !/[A-Za-z0-9]$/.test(stu)) {
      const cn = String(b.className || "").slice(0, 40);
      const inCls = cn ? await sql`select distinct m.student from hw_members m join hw_classes c on c.id = m.class_id
                                   where c.name = ${cn} and regexp_replace(m.student, '[A-Za-z0-9]+$', '') = ${stu}` : [];
      const hit = inCls.length ? inCls : await sql`select distinct student from hw_members where regexp_replace(student, '[A-Za-z0-9]+$', '') = ${stu}`;
      if (hit.length === 1) stu = hit[0].student;
    }
    const [row] = await sql`
      insert into attempts (student, class_name, book, unit_id, part, part_name, scope, total, correct, pct, secs, detail)
      values (${stu}, ${String(b.className || "").slice(0, 40)}, ${String(b.book || "영어II 천재(강상구) 1과").slice(0, 80)},
              ${String(b.unitId || "").replace(/ak$/, "").slice(0, 30)},
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
