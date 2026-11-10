// 동형모고 OMR 리포트 — 시험 만들기 · 정답(AI 추출·검수) · OMR 기록 · 서술형 AI 채점 · AI 코멘트 · 학부모 열람
import { sql, ensure, readBody, checkPin, pinError, tokenFor } from "./_db.js";
import { CUT5, ensureMock, KINDS, KIND_AREA, AREAS_ALL, BLUEPRINT45, baseName, scoreExam, reportData, loadExam, gradeOf, syncMock, backfillMock } from "./_mock.js";

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

const TYPE_RULES = `유형(d·k) 규칙:
- 듣기: 시험지에 'Listening'·'듣기'·'대화를 듣고'라고 적혀 있고 지문 없이 선택지만 있는 문항만 듣기다. 학교 내신 시험지는 거의 다 듣기가 없다. 지문이 인쇄된 문항은 절대 듣기가 아니다. 문항 번호로 유형을 짐작하지 않는다(1번이라고 듣기·목적이 아니다). 반드시 발문을 읽고 정한다.
- 발문 기준: '목적'→목적, '심경·분위기'→심경·분위기, '주장'→주장, '밑줄 친 ~가 의미하는'→함축의미, '요지'→요지, '주제'→주제, '제목'→제목, '도표'→도표, '일치/일치하지 않는'(일반 지문)→내용일치, 안내문·광고문 일치→실용문, '어법상 틀린/옳은(개수 포함)'→어법, '낱말의 쓰임이 적절하지 않은'·'문맥상 적절한 낱말'→어휘, '영영풀이'→영영풀이, 빈칸이 단어 하나→빈칸-단어, 구→빈칸-구, 절·문장→빈칸-절, '(A),(B)에 들어갈 연결어'→연결어, '전체 흐름과 관계 없는'→무관한 문장, '이어질 글의 순서'→순서, '주어진 문장이 들어가기에'→삽입, '요약문'→요약문, '가리키는 대상이 다른'·'밑줄 친 it이 가리키는'→지칭.
- d(영역)는 k에 맞춰 고른다: 목적·심경·주장·함축·요지·주제·제목=대의파악 / 도표·내용일치·실용문=세부정보 / 어법·어휘·영영풀이=어법·어휘 / 빈칸·연결어=빈칸추론 / 무관·순서·삽입·요약문=간접쓰기 / 한 지문에 2문항 이상 딸린 장문=장문독해.
영역(g) 규칙 — 학생 리포트에서 묶어 보여 줄 '이 시험의' 영역 이름이다. 수능형으로 고정하지 말고 시험지·해설지를 보고 정한다:
- 시험지에 파트·영역 제목이 있으면(예: Ⅰ. 어휘, Part 2 Grammar, [어법], 독해, 서술형) 그 제목을 짧은 한국어로 그대로 쓴다(어휘/어법/독해/듣기/서술형 등). 제목 아래 문항은 모두 그 영역이다.
- 제목이 없으면 문항이 재는 능력으로 정한다: 단어 뜻·쓰임·영영풀이=어휘, 문법=어법, 지문을 읽고 푸는 문항=독해, 듣기=듣기, 서술형=서술형. 학교 내신·레벨테스트는 보통 이렇게 3~5개 영역이다.
- 실제 수능형 전국 모의고사(45문항·듣기 1~17번)일 때만 대의파악/세부정보/빈칸추론/간접쓰기/장문독해/어법·어휘/듣기로 나눈다.
- 한 시험 안에서는 같은 영역에 같은 이름을 쓴다(글자 그대로 통일).`;
const SYS_KEY = `너는 영어 학원 선생님을 돕는 조교다. 사진은 영어 시험의 '정답 및 해설지' 페이지다.
보이는 모든 문항의 정답과 해설을 뽑아 JSON 배열 하나로만 답한다. 다른 말은 쓰지 않는다.
각 원소: {"n":"문항 번호(객관식은 숫자만, 서술형·서답형은 '서1','서2'처럼. 단 시험지가 서술형도 이어지는 번호(예: 26번)로 매기면 그 번호)","t":"o(객관식) 또는 s(서술형)","a":"객관식 정답 번호(①→1). 복수 정답이면 '2,4'. 서술형은 빈 문자열","m":"서술형 모범답안을 해설지 그대로(객관식은 빈 문자열)","r":"서술형 채점 기준·부분점수 기준이 적혀 있으면 그대로, 없으면 빈 문자열","p":"배점이 보이면 숫자, 없으면 null","e":"해설 핵심을 한국어 2~3문장으로. 정답 근거가 되는 본문 표현을 짧게 인용","d":"영역 — 다음 중 하나: ${AREAS_ALL.join(", ")}","k":"세부유형 — 다음 중 하나: ${KINDS.join(", ")}","g":"영역 이름(아래 영역 규칙)","kw":"해설지에 유형이 글자로 적혀 있으면(예: [출제의도] 글의 주제 파악, <어법>, 유형: 빈칸) 그 표현 그대로, 없으면 빈 문자열"}
해설지에 발문이 보이면 "q"에 그대로(60자까지) 넣는다. 해설지에 유형이 적혀 있지 않으면 해설 내용(무엇을 묻는지, 정답 근거)과 발문을 보고 직접 분류한다.
${TYPE_RULES}
정답 번호는 해설지에 적힌 그대로 옮긴다. 보이지 않거나 잘린 문항은 넣지 않는다.
배점(p): 해설지에 '배점표'나 문항별 점수가 있으면 반드시 옮긴다. [3점], (2.5점), <4.2점>, '배점 3.3' 처럼 소수점까지 그대로 숫자로. 정말 안 보이면 null(추측해서 2를 넣지 않는다).`;
const SYS_PAPER = `너는 고등학교 영어 시험 전문가다. 사진은 영어 시험지 페이지들이다(지문과 문항이 페이지를 넘어갈 수 있다).
이 페이지들 안에 발문과 선택지(서술형은 조건)가 모두 보이는 문항마다, 직접 문제를 풀고 유형을 분류한다.
JSON 배열 하나로만 답한다. 각 원소:
{"n":"문항 번호(객관식은 숫자만, 서술형·서답형은 '서1'처럼. 시험지가 서술형도 이어지는 번호로 매기면 그 번호)","t":"o 또는 s","p":"배점 표시가 보이면 숫자(예: [3점]→3), 없으면 null","d":"영역 — 다음 중 하나: ${AREAS_ALL.join(", ")} (서술형은 '서술형')","k":"세부유형 — 다음 중 하나: ${KINDS.join(", ")}","g":"영역 이름(아래 영역 규칙)","q":"발문을 시험지에 적힌 그대로(번호·배점·[ ] 표시는 빼고 60자까지)","ai":"네가 직접 푼 답(객관식은 번호 숫자, 서술형은 네가 쓴 답)","why":"그 답의 근거 한 줄(한국어)","full":true}
${TYPE_RULES}
지문이나 선택지가 잘려 이 페이지들만으로 풀 수 없는 문항은 "full":false 로 표시하고 ai는 빈 문자열로 둔다. 정답지를 보지 말고 스스로 푼다.
배점(p)이 가장 중요하다: 학교 시험지는 발문 끝이나 문항 번호 옆에 [3점], (2.5점), <4.2점>, '3.3점', [서술형 1] (5점) 처럼 문항마다 배점을 적는다. 보이는 숫자를 소수점까지 그대로 옮긴다. 정말 안 보이면 null(추측해서 2를 넣지 않는다).`;
const SYS_SUB = `너는 영어 학원 선생님의 서술형 채점을 돕는다. 문항마다 학생 답안 손글씨 사진, 모범답안, 채점 기준, 배점이 주어진다.
사진 대신 '학생 답(선생님·조교가 옮겨 적음)' 글이 오면 그 글이 학생 답이다. 그대로 채점하고 read에는 그 글을 그대로 넣는다.
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
  e: T(it.e, 1200), m: T(it.m, 800), r: T(it.r, 800), q: T(it.q, 60), ai: T(it.ai, 300), why: T(it.why, 300), chk: T(it.chk, 10), bp: it.bp ? 1 : 0, ...(it.ps === "ai" || it.ps === "me" ? { ps: it.ps } : {}), ...(it.dk === "me" ? { dk: "me" } : {}), ...(["어휘", "어법", "독해"].includes(it.lv) ? { lv: it.lv } : {}), ...(T(it.g, 12) ? { g: T(it.g, 12) } : {}), ...(it.gm === "me" ? { gm: "me" } : {}), ...(["ok", "diff", "one"].includes(it.kchk) ? { kchk: it.kchk, kalt: T(it.kalt, 20), kwhy: T(it.kwhy, 60) } : {}),
  ...(["change", "multi", "all", "out"].includes(it.fx) ? { fx: it.fx, fo: T(it.fo, 20) } : {}) })).filter(it => it.n);

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
        c.areaMode = ["lvl", "auto"].includes(c.areaMode) ? c.areaMode : "csat";
        c.grade = { mode: ["csat", "cut", "score"].includes((c.grade || {}).mode) ? c.grade.mode : "cut", cuts: ((c.grade || {}).cuts || []).map(Number).filter(x => x > 0).slice(0, 9) };
        if (c.grade.mode === "cut" && !c.grade.cuts.length) c.grade.cuts = CUT5.slice();
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
          const fixD = x => { if (x.t === "s") return { ...x, d: "서술형" };
            if (KIND_AREA[x.k] && x.k !== "듣기" && x.d !== "장문독해") x.d = KIND_AREA[x.k]; return x; };
          return res.status(200).json({ ok: true, items: (Array.isArray(arr) ? arr : []).map(x => fixD({ ...x, n: normN(x.n) })).filter(x => x.n) });
        } catch (e) {
          if (e.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요 (Vercel 환경변수 ANTHROPIC_API_KEY)", noKey: true });
          return res.status(400).json({ error: e.message });
        }
      }
      case "ai.name": {       // 손글씨 이름 칸 사진들 → 반 명단 중 누구인지
        const ims = (Array.isArray(b.images) ? b.images : []).slice(0, 12), names = (Array.isArray(b.names) ? b.names : []).map(x => T(x, 20)).filter(Boolean).slice(0, 80);
        if (!ims.length || !names.length) return res.status(400).json({ error: "이름 칸 사진과 명단이 필요해요" });
        try {
          const content = [];
          ims.forEach((d, i) => { content.push({ type: "text", text: `사진 ${i}:` }); content.push(img(d)); });
          content.push({ type: "text", text: `반 명단: ${JSON.stringify(names)}\n각 사진의 손글씨 이름을 읽고 명단에서 같은 학생을 고른다. JSON 배열만 출력.` });
          const txt = await claude(`너는 학원 OMR 답안지의 '이름' 칸 손글씨를 읽는 조교다. 사진마다 학생이 직접 쓴 한글 이름이 있다.
명단 이름 끝의 영문·숫자(예: 김민준51, 이은제b)는 동명이인 구분 글자라 학생은 보통 쓰지 않는다. 손글씨와 한글 이름이 같은 명단 이름을 고른다.
같은 한글 이름이 명단에 여러 명이면 손글씨에 구분 글자가 없을 때 match를 비운다. 읽을 수 없거나 명단에 없으면 match를 비운다. 억지로 고르지 않는다.
출력: [{"i":사진번호,"read":"읽은 글자","match":"명단 이름 그대로 또는 빈 문자열"}]`, content, 1500);
          const arr = jsonOf(txt, true);
          return res.status(200).json({ ok: true, res: (Array.isArray(arr) ? arr : []).map(x => ({ i: Number(x.i), read: T(x.read, 20), match: names.includes(String(x.match || "")) ? String(x.match) : "" })) });
        } catch (e) {
          if (e.message === "NO_KEY") return res.status(400).json({ error: "AI 키가 없어요", noKey: true });
          return res.status(400).json({ error: e.message });
        }
      }
      case "sheet.save": {    // OMR 한 장 (쪽 하나) 저장
        const id = Number(b.exam_id) || 0, st = T(b.student, 20);
        if (!id || !st) return res.status(400).json({ error: "시험·학생이 없어요" });
        await sql`insert into mock_sheets (exam_id, student) values (${id}, ${st}) on conflict do nothing`;
        if (b.kind === "sub") {
          const [o] = await sql`select subs from mock_sheets where exam_id = ${id} and student = ${st}`; const old = (o && o.subs) || {};
          const subs = {}; for (const [k, v] of Object.entries(b.subs || {})) { const n = normN(k), p = old[n] || {}, im = String(v.img || "").slice(0, 600000);
            subs[n] = (p.src === "edit" || (!p.img && String(p.read || "").trim())) ? { ...p, img: im } : { img: im, read: "", score: null, why: "", src: "" }; }   // 직접 넣은 답·점수는 그대로 두고 사진만 바꿈
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
        // 채점 대상: 사진이 있거나 직접 적은 학생 답이 있는 서술형. 직접 고친 칸은 점수가 비어 있을 때만(또는 force)
        const SB = s.subs || {}, only = b.only != null ? normN(b.only) : null, has = v => v && (v.img || String(v.read || "").trim());
        const subIt = ((e.cfg || {}).items || []).filter(it => it.t === "s" && (!only || it.n === only));
        const its = subIt.filter(it => has(SB[it.n]) && (b.force || SB[it.n].src !== "edit" || SB[it.n].score == null || SB[it.n].score === ""));
        if (!its.length) {
          const why = !subIt.some(it => has(SB[it.n])) ? "답안 사진도, 직접 적은 학생 답도 없어요" : "이미 점수가 들어가 있어요(직접 넣은 점수는 다시 채점하지 않아요)";
          return res.status(200).json({ ok: true, n: 0, why });
        }
        const content = [];
        its.forEach(it => { const v = SB[it.n], typed = String(v.read || "").trim() && (v.src === "edit" || !v.img);
          content.push({ type: "text", text: `[문항 ${it.n}] 배점 ${it.p}점\n모범답안: ${it.m || "(없음)"}\n채점 기준: ${it.r || "(없음 — 기본 규칙)"}\n${it.q ? "발문: " + it.q + "\n" : ""}` +
            (typed ? `학생 답(선생님·조교가 옮겨 적음): ${String(v.read).trim()}${v.img ? "\n(참고용 답안 사진:)" : ""}` : "학생 답안 사진:") });
          if (v.img) { try { content.push(img(v.img)); } catch (e3) {} } });
        content.push({ type: "text", text: "JSON 배열만 출력." });
        try {
          const arr = jsonOf(await claude(SYS_SUB, content, 3000), true);
          for (const x of arr) { const it = its.find(i => i.n === normN(x.n)); if (!it) continue;
            const sc = Math.max(0, Math.min(Number(it.p) || 0, Math.round((Number(x.score) || 0) * 2) / 2));
            const pv = SB[it.n] || {}, typed = String(pv.read || "").trim() && (pv.src === "edit" || !pv.img);
            const v = { read: typed ? T(pv.read, 600) : T(x.read, 600), score: sc, why: T(x.why, 300), src: "ai" };   // 직접 적은 답은 AI가 바꾸지 않음
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
