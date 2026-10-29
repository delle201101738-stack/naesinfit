// 꼼꼼한 인터뷰 리포트 — 조교 입력시트(구글 시트) 동기화 · 코멘트 다듬기 · 학부모 열람
import { createHash } from "node:crypto";
import { sql, ensure, readBody, checkPin, pinError, tokenFor, nameFromText } from "./_db.js";
import { listSheets, readTab, saEmail } from "./_google.js";
import { parseSheet } from "./_ivparse.js";

const FOLDER = process.env.INTERVIEW_FOLDER_ID || "1uctrfd1UOQ_i9q1KEZOqfnA5HarT83JG";   // 헤이즐쌤 > 인터뷰지 > [조교 입력시트]
const kday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const DAY = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const hash = o => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);

function warnOf(d) {
  const w = [];
  if (!d.title && !d.body) w.push("코멘트 비어 있음 → 코멘트 섹션 생략");
  if (!d.answers.length) w.push("학생 답변 비어 있음 → 빈 칸으로 나감");
  return w;
}
async function mapName(row, classes, members) {
  const c = classes.find(x => x.name === row.cls);
  const mem = c ? members.filter(m => +m.class_id === +c.id).map(m => m.student) : [];
  if (mem.includes(row.name)) return row.name;
  const base = s => s.replace(/[A-Za-z0-9]+$/, "");
  const inCls = mem.filter(m => base(m) === row.name);
  if (inCls.length === 1) return inCls[0];
  const hit = nameFromText(row.name, members.map(m => ({ student: m.student, class_name: (classes.find(x => +x.id === +m.class_id) || {}).name || "" })), row.cls);
  if (hit) return hit;
  const all = [...new Set(members.map(m => m.student))].filter(m => base(m) === row.name);
  return all.length === 1 ? all[0] : row.name;
}

async function sync(day) {
  const today = kday();
  const files = await listSheets(FOLDER);
  const classes = await sql`select id, name from hw_classes`;
  const members = await sql`select class_id, student from hw_members`;
  const out = { day, sheets: [], made: [], skipNoGrade: [], noDate: 0, errors: [] };
  for (const f of files) {
    let parsed;
    try { parsed = parseSheet(await readTab(f.id, "인터뷰기록"), today); }
    catch (e) { out.errors.push(`${f.name}: ${e.message}`); continue; }
    if (parsed.error) { out.errors.push(`${f.name}: ${parsed.error}`); continue; }
    const rows = parsed.rows;
    out.noDate += rows.filter(r => !r.day && (r.title || r.cur.some(Boolean))).length;
    const todays = rows.filter(r => r.day === day);
    out.sheets.push({ id: f.id, name: f.name, rows: rows.length, today: todays.length });
    for (const r of todays) {
      if (r.cur.every(x => !x)) { out.skipNoGrade.push(`${r.name} (${f.name.replace(/^\[.*?\]\s*/, "")})`); continue; }
      const student = await mapName(r, classes, members);
      const mh = hash({ t: r.title, b: r.body, cur: r.cur });
      const [old] = await sql`select id, memo_hash, c_src from interview_reports where sheet_id = ${f.id} and sheet_student = ${r.name} and day = ${day} and round = ${r.round}`;
      if (!old) {
        await sql`insert into interview_reports (sheet_id, sheet_name, row_no, day, round, sheet_student, student, cls, data, memo_hash, c_title, c_body, c_src)
                  values (${f.id}, ${f.name}, ${r.row}, ${day}, ${r.round}, ${r.name}, ${student}, ${r.cls}, ${JSON.stringify(r)}::jsonb, ${mh}, ${r.title}, ${r.body}, 'memo')`;
      } else {
        const changed = old.memo_hash !== mh;
        if (changed && old.c_src !== "edit")
          await sql`update interview_reports set data = ${JSON.stringify(r)}::jsonb, row_no = ${r.row}, student = ${student}, cls = ${r.cls}, memo_hash = ${mh},
                    c_title = ${r.title}, c_body = ${r.body}, c_src = 'memo', memo_changed = false, synced_at = now() where id = ${old.id}`;
        else
          await sql`update interview_reports set data = ${JSON.stringify(r)}::jsonb, row_no = ${r.row}, student = ${student}, cls = ${r.cls}, memo_hash = ${mh},
                    memo_changed = ${changed || false}, synced_at = now() where id = ${old.id}`;
      }
      out.made.push(r.name);
    }
  }
  return out;
}

// ── 코멘트 다듬기 (Anthropic API · 키가 있을 때만)
const GL = { A: "자기 말로 설명함", B: "이유를 못 댐", C: "답 자체가 흔들림", D: "답을 하지 못함" };
const SYS = `너는 영어 학원 '헤이즐쌤'의 1:1 인터뷰 리포트 코멘트를 쓰는 사람이다. 조교가 반말·축약형으로 적은 메모를 학부모가 읽을 존댓말 코멘트로 풀어 쓴다.
규칙:
- 메모와 등급에 있는 사실만 쓴다. 없는 사실을 만들거나, 등급에 없는 평가를 붙이지 않는다. 학생 이름 외의 사람·장면을 지어내지 않는다.
- 본문은 5~6문장. 실제로 아이 앞에 앉아서 본 사람이 말하듯 쓴다. 보고서 문어체·AI 말투 금지. 같은 어미('~습니다')를 계속 반복하지 말고 '~했어요', '~더라고요', '~입니다'를 섞는다. 메모에 있는 구체적인 장면을 살린다.
- 안 된 것은 흐리지 않되, 그 뒤에 지금 무엇을 하면 되는지 한 줄 붙인다. 과장하지 않고 아이를 깎아내리지 않는다.
- 오답·교재가 '미완'이면 '숙제를 다 해 오지 않아 교재 검사를 하지 못했다'는 뜻이다. '검사해 보니 부족했다'로 쓰지 않는다.
- 가장 중요한 한두 구절을 **별표 두 개**로 감싼다. 한 문단에 최대 2군데.
- 제목은 한 문장, 존댓말 또는 명사형, 25자 안팎. 메모 제목의 뜻을 그대로 살린다.
- 출력은 JSON 한 개만: {"title":"...","body":"..."}`;
async function aiComment(d) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error("NO_KEY");
  const g = d.cur.map((x, i) => `${["독해", "어휘", "어법", "오답·교재"][i]} ${x || "기록 없음"}${GL[x] ? `(${GL[x]})` : x === "미완" ? "(숙제 미완 · 미검사)" : ""}`).join(", ");
  const msg = `학생: ${d.name} / 범위: ${d.scope} / ${d.round}차 인터뷰\n이번 회차 등급: ${g}\n조교 메모 제목: ${d.title || "(없음)"}\n조교 메모 본문: ${d.body || "(없음)"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: 900, system: SYS, messages: [{ role: "user", content: msg }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("AI 요청 실패: " + ((j.error && j.error.message) || r.status));
  const txt = (j.content || []).map(c => c.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error("AI 답을 읽지 못했어요");
  const o = JSON.parse(m[0]); return { title: String(o.title || "").trim(), body: String(o.body || "").trim() };
}

const pub = r => ({ id: r.id, day: r.day, round: r.round, student: r.student, sheet_student: r.sheet_student, cls: r.cls, sheet_name: r.sheet_name,
  data: r.data, c_title: r.c_title, c_body: r.c_body, c_src: r.c_src, memo_changed: r.memo_changed, synced_at: r.synced_at, warn: warnOf(r.data) });

export default async function handler(req, res) {
  try {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    const u = new URL(req.url, "http://x");
    // 학부모: 비공개 토큰
    const tok = (u.searchParams.get("t") || "").trim().slice(0, 40);
    if (req.method === "GET" && tok) {
      const [m] = await sql`select student from report_tokens where token = ${tok}`;
      if (!m) return res.status(404).json({ error: "리포트 링크가 올바르지 않아요. 선생님께 새 링크를 받아 주세요." });
      const list = await sql`select * from interview_reports where student = ${m.student} order by day desc, round desc limit 30`;
      return res.status(200).json({ ok: true, student: m.student, list: list.map(pub) });
    }
    const gate = await checkPin(req).catch(() => ({ ok: false, why: "ERR" }));
    if (!gate.ok) return res.status(401).json({ error: pinError(gate) });
    if (req.method === "GET") {
      const day = DAY(u.searchParams.get("day")) || kday();
      const ids = (u.searchParams.get("ids") || "").split(",").map(Number).filter(Boolean);
      const list = ids.length ? await sql`select * from interview_reports where id = any(${ids}) order by cls, student`
                              : await sql`select * from interview_reports where day = ${day} order by cls, student`;
      const days = await sql`select day, count(*)::int as n from interview_reports group by day order by day desc limit 30`;
      return res.status(200).json({ ok: true, day, list: list.map(pub), days, sa: saEmail(), ai: !!process.env.ANTHROPIC_API_KEY });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });
    const b = await readBody(req);
    switch (b.action) {
      case "sync": {
        const day = DAY(b.day) || kday();
        try { const r = await sync(day); return res.status(200).json({ ok: true, ...r }); }
        catch (e) {
          if (e.message === "NO_SA") return res.status(400).json({ error: "구글 연결이 아직 안 됐어요 (Vercel 환경변수 GOOGLE_SA_JSON 필요)" });
          return res.status(400).json({ error: e.message });
        }
      }
      case "comment.set": {
        const id = Number(b.id) || 0; if (!id) return res.status(400).json({ error: "리포트가 없습니다" });
        if (b.reset) await sql`update interview_reports set c_title = data->>'title', c_body = data->>'body', c_src = 'memo', memo_changed = false where id = ${id}`;
        else await sql`update interview_reports set c_title = ${String(b.title || "").slice(0, 200)}, c_body = ${String(b.body || "").slice(0, 4000)}, c_src = 'edit', memo_changed = false where id = ${id}`;
        return res.status(200).json({ ok: true });
      }
      case "comment.ai": {
        const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean).slice(0, 40);
        const rows = await sql`select * from interview_reports where id = any(${ids})`;
        const done = [], fail = [];
        for (const r of rows) {
          if (!r.data.title && !r.data.body) { fail.push(`${r.student}: 메모가 비어 있어 코멘트를 생략해요`); continue; }
          try { const o = await aiComment(r.data);
            await sql`update interview_reports set c_title = ${o.title}, c_body = ${o.body}, c_src = 'ai', memo_changed = false where id = ${r.id}`; done.push(r.id); }
          catch (e) { if (e.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요 (Vercel 환경변수 ANTHROPIC_API_KEY)" }); fail.push(`${r.student}: ${e.message}`); }
        }
        return res.status(200).json({ ok: true, done, fail });
      }
      case "tokens": {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
        const rows = await sql`select id, student from interview_reports where id = any(${ids})`;
        const tk = await tokenFor([...new Set(rows.map(r => r.student))]);
        return res.status(200).json({ ok: true, tokens: Object.fromEntries(rows.map(r => [r.id, tk[r.student]])) });
      }
      case "delete": {
        const id = Number(b.id) || 0; await sql`delete from interview_reports where id = ${id}`; return res.status(200).json({ ok: true });
      }
      default: return res.status(400).json({ error: "알 수 없는 요청입니다" });
    }
  } catch (e) {
    console.error("[interview]", e);
    res.status(500).json({ error: "인터뷰 리포트를 처리하지 못했어요" });
  }
}
