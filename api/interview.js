// 꼼꼼한 인터뷰 리포트 — 조교 입력시트(구글 시트) 동기화 · 코멘트 다듬기 · 학부모 열람
import { createHash } from "node:crypto";
import { sql, ensure, readBody, checkPin, pinError, tokenFor, nameFromText, bump, stampOf } from "./_db.js";
import { listSheets, readTab, saEmail } from "./_google.js";
import { parseSheet, normGrade } from "./_ivparse.js";

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
- 특이사항이 있으면 그 장면(아이가 한 행동·말·태도)을 코멘트에 구체적으로 살려서 더 풍성하게 쓴다. 특이사항에도 없는 내용은 쓰지 않는다. 특이사항이 있으면 6~7문장까지 써도 된다.
- 학생 이름은 성을 빼고 부른다 (김강민 → 강민이는 / 김지유 → 지유는).
- 출력은 JSON 한 개만: {"title":"...","body":"..."}`;
async function aiComment(d) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error("NO_KEY");
  const g = d.cur.map((x, i) => `${["독해", "어휘", "어법", "오답·교재"][i]} ${x || "기록 없음"}${GL[x] ? `(${GL[x]})` : x === "미완" ? "(숙제 미완 · 미검사)" : ""}`).join(", ");
  const sp = [d.special, d.xSpecial].filter(Boolean).join("\n");
  const msg = `학생: ${d.name} / 범위: ${d.scope} / ${d.round}차 인터뷰\n이번 회차 등급: ${g}\n조교 메모 제목: ${d.title || "(없음)"}\n조교 메모 본문: ${d.body || "(없음)"}`
    + `\n특이사항(인터뷰에서 실제로 본 장면·태도·말): ${sp || "(없음)"}`
    + (d.answers && d.answers.length ? `\n학생이 실제로 한 말: ${d.answers.map(a => `"${a.q}"${a.ctx ? ` (${a.ctx})` : ""}`).join(" / ")}` : "");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: 900, system: SYS, messages: [{ role: "user", content: msg }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("AI 요청 실패: " + ((j.error && j.error.message) || r.status));
  const txt = (j.content || []).map(c => c.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error("AI 답을 읽지 못했어요");
  const o = JSON.parse(m[0]); return { title: String(o.title || "").trim(), body: String(o.body || "").trim() };
}

// ── 앱 안 입력표 · 누적 ──
const EMPTY4 = ["", "", "", ""];
const baseName = s => String(s || "").replace(/[A-Za-z0-9]+$/, "");
// 이 날짜 전까지의 인터뷰 기록 → 회차별 등급 · 마지막 회차 · 마지막 '이번 미션'(= 다음 회차의 '지난 미션')
async function historyOf(student, day) {
  const reps = await sql`select day, round, data from interview_reports where student = ${student} and day < ${day} order by day, round`;
  const [seed] = await sql`select data from iv_seed where student = ${student}`;
  const by = {}; let last = 0, missions = [], scope = "", lastDay = "";
  if (seed) { const s = seed.data || {}; Object.entries(s.byRound || {}).forEach(([k, g]) => { if (g && g.some(Boolean)) by[k] = g; }); last = +s.round || 0; missions = s.missions || []; scope = s.scope || ""; }
  for (const r of reps) {
    const d = r.data || {}; if (!d.cur || d.cur.every(x => !x)) continue;
    (d.pastRounds || []).forEach(p => { if (!by[p.n] && p.g) by[p.n] = p.g; });
    (d.past || []).forEach((g, i) => { if (g && g.some(Boolean) && !by[i + 1]) by[i + 1] = g; });
    by[r.round] = d.cur;
    if (r.round >= last) { last = r.round; missions = d.missions || []; scope = d.scope || scope; lastDay = r.day; }
  }
  return { last, next: last + 1, byRound: by, missions, scope, lastDay };
}
const T = (v, n) => String(v ?? "").trim().slice(0, n);
// 입력값 정리: 지난미션 결과는 mr0~mr2 칸으로 따로 저장(동시에 다른 칸을 고쳐도 안 덮이게) → 화면에는 mr 배열로
const normInput = v => { if (!v) return null; const o = { ...v }; const old = Array.isArray(v.mr) ? v.mr : [];
  o.mr = [0, 1, 2].map(i => String(v["mr" + i] ?? old[i] ?? "")); delete o.mr0; delete o.mr1; delete o.mr2; return o; };
const IVKEYS = new Set(["round", "scope", "teacher", "g0", "g1", "g2", "g3", "title", "body", "special", "a1", "c1", "a2", "c2", "a3", "c3", "mr0", "mr1", "mr2", "change", "f1", "f2", "f3", "m1", "m2", "m3", "home"]);
async function patchInput(cid, day, student, patch) {
  const p = {}; for (const [k, v] of Object.entries(patch || {})) if (IVKEYS.has(k)) p[k] = String(v ?? "").slice(0, 3000);
  const sid = "app:" + cid;
  await sql`insert into iv_input (cid, day, student, input)
            select ${cid}, ${day}, ${student}, coalesce((select data->'input' from interview_reports where sheet_id = ${sid} and sheet_student = ${student} and day = ${day} limit 1), '{}'::jsonb)
            on conflict do nothing`;
  const [r] = await sql`update iv_input set input = input || ${JSON.stringify(p)}::jsonb, updated_at = now()
                        where cid = ${cid} and day = ${day} and student = ${student} returning input`;
  return r.input;
}
async function saveGridRow(cid, day, student, row) {
  const [c] = await sql`select name from hw_classes where id = ${cid}`;
  const sid = "app:" + cid;
  const cur = [row.g0, row.g1, row.g2, row.g3].map(normGrade);
  const txt = ["title", "body", "special", "a1", "a2", "a3", "change", "f1", "f2", "f3", "m1", "m2", "m3", "home"].some(k => T(row[k], 9))
    || cur.some(Boolean) || (row.mr || []).some(Boolean);
  if (!txt) { await sql`delete from interview_reports where sheet_id = ${sid} and sheet_student = ${student} and day = ${day}`; return null; }
  const h = await historyOf(student, day);
  const round = Math.max(1, Math.min(20, Number(row.round) || h.next));
  const prevN = Object.keys(h.byRound).map(Number).filter(n => n < round).sort((a, b) => a - b);
  const fill = t => { t = T(t, 600); if (!t) return null; const p = t.split("::"); return p.length > 1 ? { area: p[0].trim(), text: p.slice(1).join("::").trim() } : { area: "", text: t }; };
  const data = {
    row: 0, name: baseName(student), cls: c ? c.name : "", scope: T(row.scope, 60) || h.scope, round, day, dayRaw: day, teacher: T(row.teacher, 30) || "헤이즐",
    cur, past: [1, 2, 3].map(k => h.byRound[k] || EMPTY4), pastRounds: prevN.slice(-3).map(n => ({ n, g: h.byRound[n] })),
    title: T(row.title, 200), body: T(row.body, 3000), special: T(row.special, 2000),
    answers: [1, 2, 3].map(k => ({ q: T(row["a" + k], 500), ctx: T(row["c" + k], 200) })).filter(x => x.q),
    missionsPrev: h.missions.map((t, i) => ({ t, r: T((row.mr || [])[i], 2).toUpperCase() })),
    change: T(row.change, 1000), fills: [row.f1, row.f2, row.f3].map(fill).filter(Boolean),
    missions: [row.m1, row.m2, row.m3].map(x => T(x, 300)).filter(Boolean), home: T(row.home, 400), input: row
  };
  const mh = hash({ t: data.title, b: data.body, cur });
  await sql`delete from interview_reports where sheet_id = ${sid} and sheet_student = ${student} and day = ${day} and round <> ${round}`;
  // 한 번에 넣거나 고치기 (두 선생님이 동시에 저장해도 충돌 없음). 직접 고친(edit)·AI 코멘트는 그대로 두고 '메모 바뀜'만 표시
  const [r] = await sql`insert into interview_reports (sheet_id, sheet_name, day, round, sheet_student, student, cls, data, memo_hash, c_title, c_body, c_src)
      values (${sid}, ${data.cls}, ${day}, ${round}, ${student}, ${student}, ${data.cls}, ${JSON.stringify(data)}::jsonb, ${mh}, ${data.title}, ${data.body}, 'memo')
    on conflict (sheet_id, sheet_student, day, round) do update set
      data = excluded.data, memo_hash = excluded.memo_hash, synced_at = now(),
      memo_changed = case when interview_reports.c_src in ('edit', 'ai') then (interview_reports.memo_hash <> excluded.memo_hash) or interview_reports.memo_changed else interview_reports.memo_changed end,
      c_title = case when interview_reports.c_src in ('edit', 'ai') then interview_reports.c_title else excluded.c_title end,
      c_body = case when interview_reports.c_src in ('edit', 'ai') then interview_reports.c_body else excluded.c_body end
    returning id`;
  return r.id;
}

const pub = r => ({ id: r.id, day: r.day, round: r.round, student: r.student, sheet_student: r.sheet_student, cls: r.cls, sheet_name: r.sheet_name,
  data: r.data, x_special: r.x_special || "", c_title: r.c_title, c_body: r.c_body, c_src: r.c_src, memo_changed: r.memo_changed, synced_at: r.synced_at, warn: warnOf(r.data) });

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
    if (req.method === "GET" && u.searchParams.get("ivstamp")) {   // 입력표가 몇 초마다 확인: 다른 조교가 고쳤는지
      const cid = Number(u.searchParams.get("class_id")) || 0, day = DAY(u.searchParams.get("day")) || kday();
      return res.status(200).json({ ok: true, stamp: await stampOf("iv:" + cid + ":" + day) });
    }
    if (req.method === "GET" && u.searchParams.get("grid")) {   // 입력표: 반 명단 + 누적(회차·지난 등급·지난 미션) + 그날 입력한 줄
      const cid = Number(u.searchParams.get("class_id")) || 0, day = DAY(u.searchParams.get("day")) || kday();
      const mem = (await sql`select student from hw_members where class_id = ${cid}`).map(m => m.student).sort((a, b) => a.localeCompare(b, "ko"));
      const [rows, ins, stamp] = await Promise.all([sql`select id, sheet_student, data from interview_reports where sheet_id = ${"app:" + cid} and day = ${day}`,
        sql`select student, input from iv_input where cid = ${cid} and day = ${day}`, stampOf("iv:" + cid + ":" + day)]);
      const out = [];
      for (const s of mem) { const h = await historyOf(s, day), r = rows.find(x => x.sheet_student === s), ii = ins.find(x => x.student === s);
        out.push({ student: s, name: baseName(s), hist: h, id: r ? r.id : null, input: normInput(ii ? ii.input : r ? r.data.input : null) }); }
      return res.status(200).json({ ok: true, day, class_id: cid, stamp, members: out });
    }
    if (req.method === "GET") {
      const day = DAY(u.searchParams.get("day")) || kday();
      const ids = (u.searchParams.get("ids") || "").split(",").map(Number).filter(Boolean), cls = (u.searchParams.get("cls") || "").trim();
      let list = ids.length ? await sql`select * from interview_reports where id = any(${ids}) order by cls, student`
                            : await sql`select * from interview_reports where day = ${day} order by cls, student`;
      if (cls) list = list.filter(r => r.cls === cls || r.sheet_name === cls);
      const days = await sql`select day, count(*)::int as n from interview_reports group by day order by day desc limit 30`;
      const ok = list.filter(r => (r.data.cur || []).some(Boolean)), noGrade = list.filter(r => !(r.data.cur || []).some(Boolean)).map(r => r.data.name + (r.cls ? ` (${r.cls})` : ""));
      return res.status(200).json({ ok: true, day, list: ok.map(pub), noGrade, days, sa: saEmail(), ai: !!process.env.ANTHROPIC_API_KEY });
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
        else if (b.special !== undefined && b.title === undefined) await sql`update interview_reports set x_special = ${String(b.special || "").slice(0, 2000)} where id = ${id}`;
        else {
          await sql`update interview_reports set c_title = ${String(b.title || "").slice(0, 200)}, c_body = ${String(b.body || "").slice(0, 4000)}, c_src = 'edit', memo_changed = false where id = ${id}`;
          if (b.special !== undefined) await sql`update interview_reports set x_special = ${String(b.special || "").slice(0, 2000)} where id = ${id}`;
        }
        return res.status(200).json({ ok: true });
      }
      case "comment.ai": {
        const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean).slice(0, 40);
        const rows = await sql`select * from interview_reports where id = any(${ids})`;
        const done = [], fail = [];
        for (const r of rows) {
          r.data.xSpecial = r.x_special || "";
          if (!r.data.title && !r.data.body && !r.data.special && !r.x_special) { fail.push(`${r.student}: 메모가 비어 있어 코멘트를 생략해요`); continue; }
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
      case "iv.save": {        // 입력표 한 줄 저장 (칸을 바꿀 때마다)
        const cid = Number(b.class_id) || 0, day = DAY(b.day), st = T(b.student, 20);
        if (!cid || !day || !st) return res.status(400).json({ error: "반·날짜·학생이 없습니다" });
        let id, input;
        if (b.patch && typeof b.patch === "object") {      // 바뀐 칸만 합치기 (여러 조교가 같은 줄을 고쳐도 서로 안 지움)
          let raw = await patchInput(cid, day, st, b.patch);
          id = await saveGridRow(cid, day, st, normInput(raw));
          const [now] = await sql`select input from iv_input where cid = ${cid} and day = ${day} and student = ${st}`;
          if (now && JSON.stringify(now.input) !== JSON.stringify(raw)) { raw = now.input; id = await saveGridRow(cid, day, st, normInput(raw)); }   // 그 사이 다른 조교가 고쳤으면 최신으로 한 번 더
          input = normInput(raw);
        } else { input = normInput(b.row || {}); id = await saveGridRow(cid, day, st, input); }
        const stamp = await bump("iv:" + cid + ":" + day);
        return res.status(200).json({ ok: true, id, input, stamp, hist: await historyOf(st, day) });
      }
      case "iv.seed": {        // 예전 구글 시트 기록을 누적 시작값으로
        const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 400); let n = 0;
        for (const r of rows) { const st = T(r.student, 20); if (!st) continue;
          await sql`insert into iv_seed (student, data, updated_at) values (${st}, ${JSON.stringify({ round: +r.round || 0, byRound: r.byRound || {}, missions: r.missions || [], scope: T(r.scope, 60), from: T(r.from, 60) })}::jsonb, now())
                    on conflict (student) do update set data = excluded.data, updated_at = now()`; n++; }
        return res.status(200).json({ ok: true, n });
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
