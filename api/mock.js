// 동형모고 OMR 리포트 — 시험 만들기 · 정답(AI 추출·검수) · OMR 기록 · 서술형 AI 채점 · AI 코멘트 · 학부모 열람
import { sql, ensure, readBody, checkPin, pinError, tokenFor } from "./_db.js";
import { ensureMock, KINDS, AREAS_ALL, BLUEPRINT45, baseName, scoreExam, reportData, loadExam, gradeOf, syncMock, backfillMock } from "./_mock.js";

const kday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const DAY = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const T = (v, n) => String(v ?? "").trim().slice(0, n);
const MODEL = () => process.env.MOCK_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

/* ── Anthropic 호출 ── */
async function claude(system, content, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error("NO_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens || 4000, system, messages: [{ role: "user", content }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("AI 요청 실패: " + ((j.error && j.error.message) || r.status));
  return (j.content || []).map(c => c.text || "").join("");
}
const img = d => { const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(d || "")); if (!m) throw new Error("이미지 형식이 아니에요"); return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }; };
const jsonOf = (txt, arr) => { const m = txt.match(arr ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/); if (!m) throw new Error("AI 답을 읽지 못했어요"); return JSON.parse(m[0]); };
const normN = v => { let s = String(v ?? "").trim().replace(/번$/, ""); const m = /^(?:서술형|서답형|서)\s*\[?\s*(\d+)\]?$/.exec(s); if (m) s = "서" + m[1]; return s.slice(0, 12); };

const SYS_KEY = `너는 영어 학원 선생님을 돕는 조교다. 사진은 영어 시험의 '정답 및 해설지' 페이지다.
보이는 모든 문항의 정답과 해설을 뽑아 JSON 배열 하나로만 답한다. 다른 말은 쓰지 않는다.
각 원소: {"n":"문항 번호(객관식은 숫자만, 서술형·서답형은 '서1','서2'처럼. 단 시험지가 서술형도 이어지는 번호(예: 26번)로 매기면 그 번호)","t":"o(객관식) 또는 s(서술형)","a":"객관식 정답 번호(①→1). 복수 정답이면 '2,4'. 서술형은 빈 문자열","m":"서술형 모범답안을 해설지 그대로(객관식은 빈 문자열)","r":"서술형 채점 기준·부분점수 기준이 적혀 있으면 그대로, 없으면 빈 문자열","p":"배점이 보이면 숫자, 없으면 null","e":"해설 핵심을 한국어 2~3문장으로. 정답 근거가 되는 본문 표현을 짧게 인용"}
정답 번호는 해설지에 적힌 그대로 옮긴다. 보이지 않거나 잘린 문항은 넣지 않는다.`;
const SYS_PAPER = `너는 고등학교 영어 시험 전문가다. 사진은 영어 시험지 페이지들이다(지문과 문항이 페이지를 넘어갈 수 있다).
이 페이지들 안에 발문과 선택지(서술형은 조건)가 모두 보이는 문항마다, 직접 문제를 풀고 유형을 분류한다.
JSON 배열 하나로만 답한다. 각 원소:
{"n":"문항 번호(객관식은 숫자만, 서술형·서답형은 '서1'처럼. 시험지가 서술형도 이어지는 번호로 매기면 그 번호)","t":"o 또는 s","p":"배점 표시가 보이면 숫자(예: [3점]→3), 없으면 null","d":"영역 — 다음 중 하나: ${AREAS_ALL.join(", ")} (서술형은 '서술형')","k":"세부유형 — 다음 중 하나: ${KINDS.join(", ")}","q":"발문을 15자 이내로","ai":"네가 직접 푼 답(객관식은 번호 숫자, 서술형은 네가 쓴 답)","why":"그 답의 근거 한 줄(한국어)","full":true}
지문이나 선택지가 잘려 이 페이지들만으로 풀 수 없는 문항은 "full":false 로 표시하고 ai는 빈 문자열로 둔다. 정답지를 보지 말고 스스로 푼다.`;
const SYS_SUB = `너는 영어 학원 선생님의 서술형 채점을 돕는다. 문항마다 학생 답안 손글씨 사진, 모범답안, 채점 기준, 배점이 주어진다.
1) 손글씨를 보이는 그대로 옮겨 적는다(철자·문법 실수도 고치지 말고 그대로). 읽을 수 없는 글자는 [?].
2) 모범답안·채점 기준에 맞춰 점수를 준다. 0.5점 단위, 0~배점. 채점 기준이 없으면: 핵심 내용·어법·철자를 보고 같은 뜻의 다른 표현은 인정, 어법 오류 1개당 배점의 20~30% 감점, 내용이 틀리면 0점.
3) why: 감점 이유를 학부모가 읽어도 되는 존댓말 한 문장으로(만점이면 '모범답안과 같아요' 정도).
JSON 배열 하나로만 답한다: [{"n":"문항","read":"옮겨 적은 답","score":숫자,"why":"..."}]`;
const SYS_CMT = `너는 영어 학원 담당 선생님이 학부모에게 보내는 모의고사 리포트의 '담당 선생님 총평'을 다듬는다.
입력으로 숫자 자료와, 선생님 규칙 템플릿으로 채운 총평 초안이 주어진다.
규칙:
- 초안의 사실(점수·등급·석차·상위 백분율·영역 이름과 정답률·실점·최우선 복습 문항 수·목표 정답률)과 문장 순서를 그대로 지킨다. 숫자를 바꾸거나 새 사실을 지어내지 않는다.
- 최고 영역 정답률이 75% 미만이면 '안정적으로 자리 잡았다' 같은 칭찬을 쓰지 않는다. 점수가 낮은 학생에게 사실과 어긋나는 칭찬을 쓰지 않는다.
- 학부모가 읽는 문서다. 단정적인 낙인 표현(예: 기초가 없다, 포기, 심각)을 쓰지 않는다.
- 정답률 최저 영역과 실점 최대 영역이 다르면 둘을 구분해서 말한다.
- 존댓말 '~습니다/~합니다' 문체, 5~7문장, 한 문단. 마크다운·별표를 쓰지 않는다.
- 학생은 '{이름} 학생'으로 부른다.
- 출력은 JSON 한 개만: {"body":"..."}`;
/* ── 명단 코드 (OMR 맨 아래 코드 줄 = 학생 번호) ── */
async function withRoster(cid, cfg) {
  const mem = (await sql`select student from hw_members where class_id = ${cid}`).map(m => m.student).sort((a, b) => a.localeCompare(b, "ko"));
  const ro = Array.isArray(cfg.roster) ? cfg.roster.filter(r => r && r.student && r.code > 0) : [];
  let mx = ro.reduce((m, r) => Math.max(m, r.code), 0);
  for (const s of mem) if (!ro.find(r => r.student === s)) ro.push({ code: ++mx, student: s });
  cfg.roster = ro; return cfg;
}
const cleanItems = items => (Array.isArray(items) ? items : []).slice(0, 80).map(it => ({
  n: normN(it.n), t: it.t === "s" ? "s" : "o", a: T(it.a, 20), p: Math.max(0, Math.min(100, Number(it.p) || 0)), k: T(it.k, 20), d: AREAS_ALL.includes(it.d) ? it.d : (it.t === "s" ? "서술형" : ""),
  e: T(it.e, 1200), m: T(it.m, 800), r: T(it.r, 800), q: T(it.q, 60), ai: T(it.ai, 300), why: T(it.why, 300), chk: T(it.chk, 10), bp: it.bp ? 1 : 0 })).filter(it => it.n);

const pubExam = (e, sheets) => ({ id: +e.id, class_id: +e.class_id, cls: e.cls || "", title: e.title, day: e.day, cfg: e.cfg, updated_at: e.updated_at,
  sheets: (sheets || []).map(s => ({ student: s.student, marks: s.marks, flags: s.flags, subs: Object.fromEntries(Object.entries(s.subs || {}).map(([k, v]) => [k, { ...v, img: v.img ? 1 : 0 }])),
    has_img: !!s.has_img, confirmed: s.confirmed, comment: s.comment, updated_at: s.updated_at })) });

export default async function handler(req, res) {
  try {
    await ensure(); await ensureMock(); await backfillMock().catch(e => console.error("[mock backfill]", e));
    res.setHeader("Cache-Control", "no-store");
    const u = new URL(req.url, "http://x");
    // 학부모: 비공개 토큰 → 그 학생이 본 동형모고 리포트들 (선생님이 확정한 것만)
    const tok = T(u.searchParams.get("t"), 40);
    if (req.method === "GET" && tok) {
      const [m] = await sql`select student from report_tokens where token = ${tok}`;
      if (!m) return res.status(404).json({ error: "리포트 링크가 올바르지 않아요. 선생님께 새 링크를 받아 주세요." });
      const ex = await sql`select e.id from mock_exams e join mock_sheets s on s.exam_id = e.id where s.student = ${m.student} and s.confirmed order by e.day desc, e.id desc limit 12`;
      const list = [];
      for (const x of ex) { const e = await loadExam(x.id), sh = await sql`select student, marks, subs, confirmed, comment from mock_sheets where exam_id = ${x.id}`;
        const d = await reportData(e, sh, m.student, e.cls); if (d) list.push(d); }
      return res.status(200).json({ ok: true, student: m.student, list });
    }
    const gate = await checkPin(req).catch(() => ({ ok: false, why: "ERR" }));
    if (!gate.ok) return res.status(401).json({ error: pinError(gate) });

    if (req.method === "GET") {
      if (u.searchParams.get("list")) {
        const cid = Number(u.searchParams.get("class_id")) || 0;
        const ex = cid ? await sql`select e.*, c.name as cls from mock_exams e left join hw_classes c on c.id = e.class_id where e.class_id = ${cid} order by e.day desc, e.id desc`
                       : await sql`select e.*, c.name as cls from mock_exams e left join hw_classes c on c.id = e.class_id order by e.day desc, e.id desc limit 60`;
        const cnt = await sql`select exam_id, count(*)::int as n, count(*) filter (where confirmed)::int as c from mock_sheets group by exam_id`;
        return res.status(200).json({ ok: true, kinds: KINDS, areas: AREAS_ALL, blueprint: BLUEPRINT45, ai: !!process.env.ANTHROPIC_API_KEY, exams: ex.map(e => { const k = cnt.find(x => +x.exam_id === +e.id) || {};
          return { id: +e.id, class_id: +e.class_id, cls: e.cls, title: e.title, day: e.day, nItems: ((e.cfg || {}).items || []).length, keyDone: !!(e.cfg || {}).keyDone, sheets: k.n || 0, confirmed: k.c || 0 }; }) });
      }
      const id = Number(u.searchParams.get("exam")) || 0;
      if (id && u.searchParams.get("img")) {     // 확인 화면: OMR 펴진 사진 · 서술형 칸 사진
        const st = T(u.searchParams.get("student"), 20), sub = u.searchParams.get("sub");
        const [s] = await sql`select img, subs from mock_sheets where exam_id = ${id} and student = ${st}`;
        if (!s) return res.status(404).json({ error: "없어요" });
        return res.status(200).json({ ok: true, img: sub ? ((s.subs || {})[sub] || {}).img || "" : s.img });
      }
      if (id && u.searchParams.get("report")) {   // 리포트 화면 (선생님)
        const e = await loadExam(id); if (!e) return res.status(404).json({ error: "시험이 없어요" });
        const sh = await sql`select student, marks, subs, confirmed, comment from mock_sheets where exam_id = ${id}`;
        const only = T(u.searchParams.get("student"), 20);
        const list = [];
        for (const s of sh.filter(x => x.confirmed && (!only || x.student === only)).sort((a, b) => a.student.localeCompare(b.student, "ko"))) { const d = await reportData(e, sh, s.student, e.cls); if (d) list.push(d); }
        const tk = await tokenFor(list.map(d => d.student));
        list.forEach(d => { d.token = tk[d.student]; });
        return res.status(200).json({ ok: true, list, ai: !!process.env.ANTHROPIC_API_KEY });
      }
      if (id) {
        const e = await loadExam(id); if (!e) return res.status(404).json({ error: "시험이 없어요" });
        const sh = await sql`select student, marks, flags, subs, confirmed, comment, updated_at, (img <> '') as has_img from mock_sheets where exam_id = ${id}`;
        const S = scoreExam(e, sh);
        return res.status(200).json({ ok: true, kinds: KINDS, areas: AREAS_ALL, blueprint: BLUEPRINT45, ai: !!process.env.ANTHROPIC_API_KEY, exam: pubExam(e, sh),
          stats: { total: S.total, n: S.n, avg: S.avg, max: S.max, min: S.min, itemRate: S.itemRate, scores: Object.fromEntries(S.per.map(p => [p.student, { score: p.score, rank: p.rank, grade: (gradeOf(e.cfg || {}, p.score, S.total) || {}).label || "" }])) } });
      }
      return res.status(400).json({ error: "무엇을 불러올지 없어요" });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET·POST만 받습니다" });
    const b = await readBody(req);
    switch (b.action) {
      case "exam.save": {
        const cid = Number(b.class_id) || 0, title = T(b.title, 80), day = DAY(b.day) || kday();
        if (!cid || !title) return res.status(400).json({ error: "반과 시험 이름이 필요해요" });
        const prev = b.id ? await loadExam(Number(b.id)) : null;
        const c = { ...((prev && prev.cfg) || {}), ...(b.cfg || {}) };
        if (b.cfg && b.cfg.items) c.items = cleanItems(b.cfg.items);
        c.academy = T(c.academy, 30) || "헤이즐 영어";
        c.grade = { mode: ["csat", "cut", "score"].includes((c.grade || {}).mode) ? c.grade.mode : "csat", cuts: ((c.grade || {}).cuts || []).map(Number).filter(x => x > 0).slice(0, 9) };
        await withRoster(cid, c);
        let id;
        if (prev) { await sql`update mock_exams set class_id = ${cid}, title = ${title}, day = ${day}, cfg = ${JSON.stringify(c)}::jsonb, updated_at = now() where id = ${prev.id}`; id = +prev.id; }
        else { const [r] = await sql`insert into mock_exams (class_id, title, day, cfg) values (${cid}, ${title}, ${day}, ${JSON.stringify(c)}::jsonb) returning id`; id = +r.id; }
        const e = await loadExam(id); await syncMock(id);
        return res.status(200).json({ ok: true, exam: pubExam(e, []) });
      }
      case "exam.delete": {
        const id = Number(b.id) || 0;
        await sql`delete from mock_sheets where exam_id = ${id}`; await sql`delete from mock_exams where id = ${id}`; await syncMock(id);
        return res.status(200).json({ ok: true });
      }
      case "ai.key":          // 해설지 페이지 → 정답·해설
      case "ai.paper": {      // 시험지 페이지 → AI가 직접 풀기 + 유형
        const ims = (Array.isArray(b.images) ? b.images : []).slice(0, 3);
        if (!ims.length) return res.status(400).json({ error: "페이지 사진이 없어요" });
        try {
          const txt = await claude(b.action === "ai.key" ? SYS_KEY : SYS_PAPER,
            [...ims.map(img), { type: "text", text: `페이지 ${T(b.pages, 30) || ""}. JSON 배열만 출력.` }], 6000);
          const arr = jsonOf(txt, true);
          return res.status(200).json({ ok: true, items: (Array.isArray(arr) ? arr : []).map(x => ({ ...x, n: normN(x.n) })).filter(x => x.n) });
        } catch (e) {
          if (e.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요 (Vercel 환경변수 ANTHROPIC_API_KEY)", noKey: true });
          return res.status(400).json({ error: e.message });
        }
      }
      case "sheet.save": {    // OMR 한 장 (쪽 하나) 저장
        const id = Number(b.exam_id) || 0, st = T(b.student, 20);
        if (!id || !st) return res.status(400).json({ error: "시험·학생이 없어요" });
        await sql`insert into mock_sheets (exam_id, student) values (${id}, ${st}) on conflict do nothing`;
        if (b.kind === "sub") {
          const subs = {}; for (const [k, v] of Object.entries(b.subs || {})) subs[normN(k)] = { img: String(v.img || "").slice(0, 600000), read: "", score: null, why: "", src: "" };
          await sql`update mock_sheets set subs = subs || ${JSON.stringify(subs)}::jsonb, confirmed = false, updated_at = now() where exam_id = ${id} and student = ${st}`;
        } else {
          await sql`update mock_sheets set marks = ${JSON.stringify(b.marks || {})}::jsonb, flags = ${JSON.stringify(b.flags || {})}::jsonb,
                    img = ${String(b.img || "").slice(0, 1500000)}, confirmed = false, updated_at = now() where exam_id = ${id} and student = ${st}`;
        }
        await syncMock(id);
        return res.status(200).json({ ok: true });
      }
      case "sheet.set": {     // 확인 화면에서 고치기 · 확정
        const id = Number(b.exam_id) || 0, st = T(b.student, 20);
        await sql`insert into mock_sheets (exam_id, student) values (${id}, ${st}) on conflict do nothing`;
        if (b.marks) await sql`update mock_sheets set marks = marks || ${JSON.stringify(b.marks)}::jsonb, flags = flags || ${JSON.stringify(Object.fromEntries(Object.keys(b.marks).map(k => [k, ""])))}::jsonb where exam_id = ${id} and student = ${st}`;
        if (b.sub) { const k = normN(b.sub.n), v = { score: b.sub.score === "" || b.sub.score == null ? null : Number(b.sub.score), read: T(b.sub.read, 600), why: T(b.sub.why, 300), src: "edit" };
          await sql`update mock_sheets set subs = jsonb_set(subs, ${[k]}, coalesce(subs->${k}, '{}'::jsonb) || ${JSON.stringify(v)}::jsonb) where exam_id = ${id} and student = ${st}`; }
        if (b.confirmed !== undefined) await sql`update mock_sheets set confirmed = ${!!b.confirmed} where exam_id = ${id} and student = ${st}`;
        if (b.comment) await sql`update mock_sheets set comment = ${JSON.stringify({ title: T(b.comment.title, 200), body: T(b.comment.body, 4000), src: "edit" })}::jsonb where exam_id = ${id} and student = ${st}`;
        await sql`update mock_sheets set updated_at = now() where exam_id = ${id} and student = ${st}`;
        if (b.marks || b.sub || b.confirmed !== undefined) await syncMock(id);
        return res.status(200).json({ ok: true });
      }
      case "sheet.move": {    // 이름을 잘못 붙였을 때 다른 학생으로 옮기기
        const id = Number(b.exam_id) || 0, from = T(b.from, 20), to = T(b.to, 20);
        const [ex] = await sql`select 1 from mock_sheets where exam_id = ${id} and student = ${to}`;
        if (ex) return res.status(400).json({ error: `${to} 학생 OMR이 이미 있어요. 먼저 지워 주세요.` });
        await sql`update mock_sheets set student = ${to} where exam_id = ${id} and student = ${from}`; await syncMock(id);
        return res.status(200).json({ ok: true });
      }
      case "sheet.delete": {
        await sql`delete from mock_sheets where exam_id = ${Number(b.exam_id) || 0} and student = ${T(b.student, 20)}`; await syncMock(b.exam_id);
        return res.status(200).json({ ok: true });
      }
      case "sub.grade": {     // 서술형 AI 채점 (학생 한 명씩)
        const id = Number(b.exam_id) || 0, st = T(b.student, 20), e = await loadExam(id);
        const [s] = await sql`select subs from mock_sheets where exam_id = ${id} and student = ${st}`;
        if (!e || !s) return res.status(404).json({ error: "OMR이 없어요" });
        const its = ((e.cfg || {}).items || []).filter(it => it.t === "s" && (s.subs || {})[it.n] && s.subs[it.n].img && (b.force || s.subs[it.n].src !== "edit"));
        if (!its.length) return res.status(200).json({ ok: true, n: 0 });
        const content = [];
        its.forEach(it => { content.push({ type: "text", text: `[문항 ${it.n}] 배점 ${it.p}점\n모범답안: ${it.m || "(없음)"}\n채점 기준: ${it.r || "(없음 — 기본 규칙)"}\n${it.q ? "발문: " + it.q + "\n" : ""}학생 답안 사진:` }); content.push(img(s.subs[it.n].img)); });
        content.push({ type: "text", text: "JSON 배열만 출력." });
        try {
          const arr = jsonOf(await claude(SYS_SUB, content, 3000), true);
          for (const x of arr) { const it = its.find(i => i.n === normN(x.n)); if (!it) continue;
            const sc = Math.max(0, Math.min(Number(it.p) || 0, Math.round((Number(x.score) || 0) * 2) / 2));
            const v = { read: T(x.read, 600), score: sc, why: T(x.why, 300), src: "ai" };
            await sql`update mock_sheets set subs = jsonb_set(subs, ${[it.n]}, subs->${it.n} || ${JSON.stringify(v)}::jsonb), updated_at = now() where exam_id = ${id} and student = ${st}`; }
          await syncMock(id);
          return res.status(200).json({ ok: true, n: arr.length });
        } catch (e2) {
          if (e2.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요 (Vercel 환경변수 ANTHROPIC_API_KEY)", noKey: true });
          return res.status(400).json({ error: e2.message });
        }
      }
      case "comment.ai": {    // 리포트 코멘트 (학생 한 명씩)
        const id = Number(b.exam_id) || 0, st = T(b.student, 20), e = await loadExam(id);
        const sh = await sql`select student, marks, subs, confirmed, comment from mock_sheets where exam_id = ${id}`;
        const d = e && await reportData(e, sh, st, e.cls);
        if (!d) return res.status(400).json({ error: "확정된 OMR이 없어요" });
        const msg = `학생: ${d.name} / 시험: ${d.exam.title} (${d.exam.day})
점수 ${d.score}/${d.total}${d.grade ? ` · ${d.grade.label}` : ""} · 응시 ${d.allN}명 중 ${d.allRank}위(상위 ${d.topPct}%) · 반 석차 ${d.rank}/${d.n} · 반 평균 ${d.avg}
영역(정답률/반평균/실점): ${d.areas.map(a => `${a.a} ${a.pct}%/${a.cls ?? "-"}%/${Math.round((a.max - a.got) * 10) / 10}점`).join(", ")}
최우선 복습(반 정답률 70%↑인데 틀림): ${d.wrong.filter(w => w.pri).map(w => w.n + "번").join(", ") || "없음"}
총평 초안: ${d.template}`;
        try {
          const o = jsonOf(await claude(SYS_CMT, [{ type: "text", text: msg }], 1200), false);
          const c = { title: "", body: T(o.body, 4000).replace(/\*\*/g, ""), src: "ai" };
          await sql`update mock_sheets set comment = ${JSON.stringify(c)}::jsonb where exam_id = ${id} and student = ${st}`;
          return res.status(200).json({ ok: true, comment: c });
        } catch (e2) {
          if (e2.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요 (Vercel 환경변수 ANTHROPIC_API_KEY)", noKey: true });
          return res.status(400).json({ error: e2.message });
        }
      }
      default: return res.status(400).json({ error: "알 수 없는 요청입니다" });
    }
  } catch (e) {
    console.error("[mock]", e);
    res.status(500).json({ error: "동형모고를 처리하지 못했어요" });
  }
}
