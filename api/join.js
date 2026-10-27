// 학생 앱: 학교+학년(반) 목록 + 이름 확인·등록 (비밀번호 없음)
// 이름 뒤 알파벳·숫자 구분자(김승현4, 김재희n)는 빼고 써도 명단 이름으로 찾아 줌
import { sql, ensure, readBody } from "./_db.js";

const clean = s => String(s || "").replace(/\s+/g, "").slice(0, 20);
const base = s => clean(s).replace(/[A-Za-z0-9]+$/, "");

export default async function handler(req, res) {
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const classes = await sql`select id, name from hw_classes order by right(name, 1), name`;
      return res.status(200).json({ ok: true, classes });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });
    const b = await readBody(req);
    const typed = clean(b.student), cid = Number(b.class_id) || 0, prevName = clean(b.prev_name);
    if (typed.length < 2 || !cid) return res.status(400).json({ error: "학교·학년과 이름을 넣어 주세요" });
    const [c] = await sql`select id, name from hw_classes where id = ${cid}`;
    if (!c) return res.status(404).json({ error: "없는 학교·학년입니다. 새로고침 후 다시 골라 주세요" });

    const mem = (await sql`select student from hw_members where class_id = ${cid}`).map(r => r.student);
    let name = mem.find(m => m === typed) || null;
    if (!name) {
      const cand = mem.filter(m => base(m) === base(typed) && (base(typed) === typed || m.toLowerCase() === typed.toLowerCase()));
      if (cand.length === 1) name = cand[0];
      else if (cand.length > 1) return res.status(200).json({ ok: false, choose: cand, class: c });
    }
    if (!name) {
      if (!b.confirm_new) return res.status(200).json({ ok: false, notfound: true, class: c });
      name = typed;                                   // 명단에 없는 새 학생 — 선생님 확인용으로 반에 넣어 둠
      await sql`insert into hw_members (class_id, student) values (${cid}, ${name}) on conflict do nothing`;
    }

    // 예전에 구분자 없이 쓰던 이름(예: 김승현)의 시험 기록을 명단 이름(김승현4)으로 옮김 — 같은 이름이 명단에 하나뿐일 때만
    let moved = 0;
    if (prevName && prevName !== name && base(prevName) === base(name)) {
      const same = await sql`select distinct student from hw_members where student <> ${name}`;
      if (!same.some(r => base(r.student) === base(name))) {
        const r1 = await sql`update attempts set student = ${name} where student = ${prevName} returning id`;
        moved = r1.length;
      }
    }
    res.status(200).json({ ok: true, name, class: c, moved });
  } catch (e) {
    console.error("[join]", e);
    res.status(500).json({ error: "들어가지 못했습니다. 잠시 후 다시 해 주세요" });
  }
}
