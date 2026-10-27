// 반 · 숙제 관리 (선생님 비밀번호 필요) — 시험 기록과 별개
import { sql, ensure, readBody, checkPin } from "./_db.js";

const S = (v, n) => String(v ?? "").trim().slice(0, n);
const DAY = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const STATUS = new Set(["done", "part", "none", "skip"]);

async function snapshot() {
  const [classes, members, items, checks, students] = await Promise.all([
    sql`select id, name, created_at from hw_classes order by right(name, 1), name`,
    sql`select class_id, student from hw_members order by student`,
    sql`select id, class_id, day, title, memo, created_at from hw_items order by day desc, id desc limit 1500`,
    sql`select item_id, student, status, score, memo, checked_at from hw_checks`,
    sql`select distinct student from attempts order by student`
  ]);
  return { ok: true, classes, members, items, checks, students: students.map(r => r.student) };
}

export default async function handler(req, res) {
  const gate = checkPin(req);
  if (!gate.ok) return res.status(401).json({ error: gate.why === "NO_PIN" ? "선생님 비밀번호가 아직 설정되지 않았습니다" : "비밀번호가 맞지 않습니다" });
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json(await snapshot());
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });

    const b = await readBody(req);
    const id = Number(b.id) || 0;
    switch (b.action) {
      case "class.create": {
        const name = S(b.name, 40); if (!name) return res.status(400).json({ error: "반 이름이 없습니다" });
        const [r] = await sql`insert into hw_classes (name) values (${name}) returning id`;
        return res.status(200).json({ ok: true, id: r.id });
      }
      case "class.rename": {
        const name = S(b.name, 40); if (!id || !name) return res.status(400).json({ error: "반 이름이 없습니다" });
        await sql`update hw_classes set name = ${name} where id = ${id}`; break;
      }
      case "class.delete": {
        if (!id) return res.status(400).json({ error: "반이 없습니다" });
        await sql`delete from hw_checks where item_id in (select id from hw_items where class_id = ${id})`;
        await sql`delete from hw_items where class_id = ${id}`;
        await sql`delete from hw_members where class_id = ${id}`;
        await sql`delete from hw_classes where id = ${id}`; break;
      }
      case "members.set": {
        const cid = Number(b.class_id) || 0; if (!cid) return res.status(400).json({ error: "반이 없습니다" });
        const list = [...new Set((Array.isArray(b.students) ? b.students : []).map(x => S(x, 20)).filter(Boolean))].slice(0, 200);
        await sql`delete from hw_members where class_id = ${cid} and not (student = any(${list}))`;
        for (const st of list) await sql`insert into hw_members (class_id, student) values (${cid}, ${st}) on conflict do nothing`;
        break;
      }
      case "item.create": {
        const cid = Number(b.class_id) || 0, day = DAY(b.day), title = S(b.title, 120);
        if (!cid || !day || !title) return res.status(400).json({ error: "반·날짜·숙제 내용을 모두 넣어 주세요" });
        const [r] = await sql`insert into hw_items (class_id, day, title, memo) values (${cid}, ${day}, ${title}, ${S(b.memo, 600)}) returning id`;
        return res.status(200).json({ ok: true, id: r.id });
      }
      case "item.update": {
        const day = DAY(b.day), title = S(b.title, 120);
        if (!id || !day || !title) return res.status(400).json({ error: "날짜·숙제 내용을 넣어 주세요" });
        await sql`update hw_items set day = ${day}, title = ${title}, memo = ${S(b.memo, 600)} where id = ${id}`; break;
      }
      case "item.delete": {
        if (!id) return res.status(400).json({ error: "숙제가 없습니다" });
        await sql`delete from hw_checks where item_id = ${id}`;
        await sql`delete from hw_items where id = ${id}`; break;
      }
      case "check.set": {
        const iid = Number(b.item_id) || 0, st = S(b.student, 20), status = S(b.status, 8);
        if (!iid || !st) return res.status(400).json({ error: "숙제·학생이 없습니다" });
        if (!STATUS.has(status)) { await sql`delete from hw_checks where item_id = ${iid} and student = ${st}`; break; }
        const sc = b.score === "" || b.score == null || !Number.isFinite(+b.score) ? null : Math.max(0, Math.min(100, Math.round(+b.score)));
        await sql`insert into hw_checks (item_id, student, status, score, memo, checked_at)
                  values (${iid}, ${st}, ${status}, ${sc}, ${S(b.memo, 300)}, now())
                  on conflict (item_id, student) do update
                  set status = excluded.status, score = excluded.score, memo = excluded.memo, checked_at = now()`;
        break;
      }
      default: return res.status(400).json({ error: "알 수 없는 요청입니다" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[hw]", e);
    res.status(500).json({ error: "숙제 정보를 저장하지 못했습니다" });
  }
}
