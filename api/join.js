// 학생 앱: 학교+학년(반) 목록 + 이름 확인·등록 (비밀번호 없음)
// 이름 뒤 알파벳·숫자 구분자(김승현4, 김재희n)는 빼고 써도 명단 이름으로 찾아 줌
import { sql, ensure, readBody, nameFromText, bump } from "./_db.js";

const clean = s => String(s || "").replace(/\s+/g, "").slice(0, 20);
const base = s => clean(s).replace(/[A-Za-z0-9]+$/, "");

export default async function handler(req, res) {
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const who = clean(q.get("student")), wc = Number(q.get("class_id")) || 0;
      if (who && wc) {   // 학생 앱 '내 할 일': 내 반 숙제(최근 2주 ~ 다음 1주) + 내 검사 결과 + 시험 날짜
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        const from = new Date(Date.now() + 9 * 3600e3 - 14 * 864e5).toISOString().slice(0, 10);
        const to = new Date(Date.now() + 9 * 3600e3 + 7 * 864e5).toISOString().slice(0, 10);
        const [c] = await sql`select id, name, exam_date, exam_name from hw_classes where id = ${wc}`;
        const items = await sql`select i.id, i.day, i.title, k.status from hw_items i
                                left join hw_checks k on k.item_id = i.id and k.student = ${who}
                                where i.class_id = ${wc} and i.day >= ${from} and i.day <= ${to} order by i.day desc, i.id`;
        return res.status(200).json({ ok: true, today, class: c || null, items });
      }
      const classes = await sql`select id, name, exam_date, exam_name from hw_classes order by right(name, 1), name`;
      return res.status(200).json({ ok: true, classes });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });
    const b = await readBody(req);
    const typed = clean(b.student), cid = Number(b.class_id) || 0, prevName = clean(b.prev_name);
    if (typed.length < 2 || !cid) return res.status(400).json({ error: "학교·학년과 이름을 넣어 주세요" });
    const [c] = await sql`select id, name from hw_classes where id = ${cid}`;
    if (!c) return res.status(404).json({ error: "없는 학교·학년입니다. 새로고침 후 다시 골라 주세요" });

    const mem = (await sql`select student from hw_members where class_id = ${cid}`).map(r => r.student);
    let name = mem.find(m => m === typed) || null, renamed = false, added = false;
    if (!name) {
      const cand = mem.filter(m => base(m) === base(typed) && (base(typed) === typed || m.toLowerCase() === typed.toLowerCase()));
      if (cand.length === 1) name = cand[0];
      else if (cand.length > 1) return res.status(200).json({ ok: false, choose: cand, class: c });
    }
    if (!name && !b.confirm_new) {   // 이름 칸에 학교·학년까지 쓴 경우 (김지연_경인1)
      const hit = nameFromText(b.student, mem.map(m => ({ student: m, class_name: c.name })), c.name);
      if (hit) name = hit;
    }
    if (!name && !b.confirm_new) {   // 오타 같으면(한 글자만 다름) 먼저 물어봄: 김강빈 → 혹시 김강민j?
      const ed1 = (x, y) => { if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++d > 1) return false; return d === 1; };
      const sim = mem.filter(m => ed1(base(m), base(typed)));
      if (sim.length) return res.status(200).json({ ok: false, similar: sim, class: c });
    }
    if (!name) {
      // 명단에 없으면 고른 학교·학년(반)에 자동 등록
      name = typed;                                   // 명단에 없는 새 학생 — 선생님 확인용으로 반에 넣어 둠
      // 동명이인: 다른 반에 같은 이름이 이미 있으면 기록이 섞이지 않게 뒤에 번호를 붙임 (김민준 → 김민준2)
      if (!/^[가-힣]{2,5}[A-Za-z0-9]*$/.test(typed)) return res.status(400).json({ error: "이름은 한글로 정확히 써 주세요 (학교·학년은 위에서 골라요)" });
      const taken = async n => (await sql`select 1 from hw_members where student = ${n} limit 1`).length > 0;
      if (await taken(name)) { let k = 2; while (k < 100 && await taken(typed + k)) k++; name = typed + k; renamed = true; }
      await sql`insert into hw_members (class_id, student) values (${cid}, ${name}) on conflict do nothing`;
      await bump("hw").catch(() => {});
      added = true;
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
    res.status(200).json({ ok: true, name, class: c, moved, renamed, added });
  } catch (e) {
    console.error("[join]", e);
    res.status(500).json({ error: "들어가지 못했습니다. 잠시 후 다시 해 주세요" });
  }
}
