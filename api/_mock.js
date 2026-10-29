// 동형모고 OMR — 표 · 채점 · 리포트 데이터 (api/mock.js · api/rpage.js 가 같이 씀)
// 리포트 규칙 = 헤이즐 쌤 '영어 모의고사 자동채점 · 학부모 리포트 생성 규칙' (영역 7개 · 절대평가 · 석차+상위% · 총평 템플릿 · 학습 처방)
import { sql } from "./_db.js";

let ready = false;
export async function ensureMock() {
  if (ready) return;
  await sql`create table if not exists mock_exams (
      id bigserial primary key, class_id bigint not null, title text not null, day text not null,
      cfg jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
  await sql`create table if not exists mock_sheets (
      exam_id bigint not null, student text not null, marks jsonb not null default '{}'::jsonb, flags jsonb not null default '{}'::jsonb,
      img text not null default '', subs jsonb not null default '{}'::jsonb, confirmed boolean not null default false,
      comment jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key (exam_id, student))`;
  ready = true;
}

/* ── 영역 7개 (순서 고정) + 내신 서술형 ── */
export const AREAS = ["듣기", "대의파악", "세부정보", "어법·어휘", "빈칸추론", "간접쓰기", "장문독해"];
export const AREAS_ALL = [...AREAS, "서술형"];
/* 45문항 표준 모의고사 청사진 [영역, 세부유형] */
const BP = {
  1: "목적", 2: "의견", 3: "관계", 4: "그림일치", 5: "할 일", 6: "금액", 7: "이유", 8: "언급되지 않은 것", 9: "내용일치", 10: "도표",
  11: "짧은 대화 응답", 12: "짧은 대화 응답", 13: "긴 대화 응답", 14: "긴 대화 응답", 15: "상황에 적절한 말", 16: "장문-주제", 17: "장문-언급",
  18: "목적", 19: "심경·분위기", 20: "주장", 21: "함축의미", 22: "요지", 23: "주제", 24: "제목", 25: "도표", 26: "내용일치", 27: "실용문", 28: "실용문",
  29: "어법", 30: "어휘", 31: "빈칸-단어", 32: "빈칸-구", 33: "빈칸-절", 34: "빈칸-절", 35: "무관한 문장", 36: "순서", 37: "순서", 38: "삽입", 39: "삽입", 40: "요약문",
  41: "장문-제목", 42: "장문-어휘", 43: "복합장문-순서", 44: "복합장문-지칭", 45: "복합장문-일치" };
const AREA_BY_N = n => n <= 17 ? "듣기" : n <= 24 ? "대의파악" : n <= 28 ? "세부정보" : n <= 30 ? "어법·어휘" : n <= 34 ? "빈칸추론" : n <= 40 ? "간접쓰기" : "장문독해";
const THREE = [15, 21, 24, 30, 31, 33, 34, 37, 39, 42];
export const BLUEPRINT45 = Array.from({ length: 45 }, (_, i) => ({ n: String(i + 1), t: "o", d: AREA_BY_N(i + 1), k: BP[i + 1], p: THREE.includes(i + 1) ? 3 : 2 }));
/* 세부유형 목록 (드롭다운·AI 분류용) */
export const KINDS = ["목적", "심경·분위기", "주장", "함축의미", "요지", "주제", "제목", "도표", "내용일치", "실용문", "어법", "어휘",
  "빈칸-단어", "빈칸-구", "빈칸-절", "무관한 문장", "순서", "삽입", "요약문", "장문-제목", "장문-어휘", "복합장문-순서", "복합장문-지칭", "복합장문-일치",
  "지칭", "영영풀이", "연결어", "듣기", "서술형(영작)", "서술형(어법 고치기)", "서술형(빈칸·어휘)", "서술형(요약·주제)", "서술형(기타)"];
const KIND_AREA = { "목적": "대의파악", "심경·분위기": "대의파악", "주장": "대의파악", "함축의미": "대의파악", "요지": "대의파악", "주제": "대의파악", "제목": "대의파악",
  "도표": "세부정보", "내용일치": "세부정보", "실용문": "세부정보", "어법": "어법·어휘", "어휘": "어법·어휘", "영영풀이": "어법·어휘",
  "빈칸-단어": "빈칸추론", "빈칸-구": "빈칸추론", "빈칸-절": "빈칸추론", "연결어": "빈칸추론", "무관한 문장": "간접쓰기", "순서": "간접쓰기", "삽입": "간접쓰기", "요약문": "간접쓰기",
  "장문-제목": "장문독해", "장문-어휘": "장문독해", "복합장문-순서": "장문독해", "복합장문-지칭": "장문독해", "복합장문-일치": "장문독해", "지칭": "장문독해", "듣기": "듣기" };
export const areaOf = it => (it.t === "s" ? "서술형" : AREAS_ALL.includes(it.d) ? it.d : KIND_AREA[it.k] || (/^서술형/.test(it.k || "") ? "서술형" : "대의파악"));

/* 영역별 학습 처방 (선생님 문구 그대로) */
export const RX = {
  "듣기": ["받아쓰기(딕테이션) 위주로 잡아야 합니다.", ["매일 1회분 듣기 17문항을 실전 속도로 풀고, 틀린 문항은 스크립트를 보지 않고 3회 반복 청취", "그래도 안 들리는 문장만 받아쓰기 → 스크립트 대조 → 소리 내어 3회 따라 읽기", "숫자·요일·가격이 나오는 6·7번 유형은 메모 습관을 먼저 고정"]],
  "대의파악": ["글의 첫 문장과 마지막 문장을 연결하는 훈련이 필요합니다.", ["지문을 읽고 선지를 보기 전에 한글 한 문장으로 주제를 먼저 적어보기", "역접 연결어(However, But, Yet) 뒤 문장에 반드시 표시하고 그 문장을 주제 후보로 삼기", "오답 선지가 '너무 넓거나 / 너무 좁은' 이유를 매번 한 줄로 적기"]],
  "세부정보": ["선지와 본문을 대조하는 절차를 고정해야 합니다.", ["선지를 먼저 읽고 키워드에 동그라미 → 본문에서 해당 위치를 찾아 밑줄 → 대조", "숫자·연도·장소·부정어(not, never, only)를 만나면 무조건 표시", "실용문(안내문)은 예외 조항(단, 제외, 별도 요금)이 정답 근거인 경우가 많음"]],
  "어법·어휘": ["빈출 어법 포인트를 유형별로 정리해야 합니다.", ["동사의 수일치 / 시제 / 태, 준동사(to부정사·동명사·분사), 관계사, 대명사 일치 5개를 축으로 정리", "밑줄 문제는 '이 자리에 무엇이 와야 하는가'를 먼저 판단한 뒤 밑줄을 보기", "어휘 문제는 문맥의 방향(긍정/부정)을 화살표로 표시한 뒤 반대말 함정을 확인"]],
  "빈칸추론": ["가장 시급한 영역입니다. 근거 문장 찾기부터 다시 잡아야 합니다.", ["빈칸 문장을 먼저 정확히 해석하고, 빈칸이 '무엇에 대한 설명'인지 한글로 적기", "정답의 근거가 되는 문장을 지문에서 반드시 한 문장 지목하는 훈련 (근거 없이 고르지 않기)", "주 3회, 회당 4문항씩 시간을 재고 풀되 채점보다 근거 확인에 2배의 시간 쓰기"]],
  "간접쓰기": ["연결 장치(지시어·대명사·연결어)를 추적하는 훈련이 필요합니다.", ["순서·삽입은 대명사(it, they, this)와 관사(the)가 가리키는 대상을 화살표로 연결", "주어진 문장의 첫 단어가 연결어라면 앞 문단의 논지 방향을 먼저 확정", "무관한 문장은 '소재는 같지만 논지가 다른' 문장이 정답이라는 점을 기억"]],
  "장문독해": ["긴 지문에서 집중력을 유지하는 시간 관리가 필요합니다.", ["41~45번을 항상 마지막이 아니라 중간(30번 직후)에 푸는 순서 실험", "복합장문은 등장인물 이름 옆에 (A)(B)(C) 표시하며 읽어 지칭 문제를 자동 해결", "문단별로 한글 5글자 요약을 여백에 적으며 읽기"]],
  "서술형": ["조건을 빠짐없이 지키는 답안 작성 절차를 고정해야 합니다.", ["문제의 조건(단어 수·형태 변화·주어진 단어 사용)에 번호를 붙이고 답을 쓴 뒤 하나씩 체크", "틀린 서술형은 모범답안을 보지 않고 다시 써 본 뒤, 감점 이유를 한 줄로 적기", "본문 핵심 문장 10개를 우리말만 보고 영작하는 연습을 주 3회"]]
};

export const baseName = s => String(s || "").replace(/[A-Za-z0-9]+$/, "");
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r1 = v => Math.round(v * 10) / 10;

/* 한 문항 채점 */
export function itemScore(it, sh) {
  const p = num(it.p);
  if (it.t === "s") { const s = (sh.subs || {})[it.n] || {}; const v = s.score === "" || s.score == null ? null : Math.max(0, Math.min(p, num(s.score))); return { got: v == null ? 0 : v, max: p, ok: v != null && v >= p, part: v != null && v > 0 && v < p, mark: s.read || "", graded: v != null }; }
  const m = String((sh.marks || {})[it.n] ?? "").trim(), acc = String(it.a || "").split(/[,\s/]+/).filter(Boolean);
  const ok = acc.includes("*") || (!!m && !m.includes(",") && acc.includes(m));
  return { got: ok ? p : 0, max: p, ok, mark: m, graded: true };
}
/* 등급: 절대평가 90↑1 … 20↑8 그 외 9 (100점 환산) */
export const csatGrade = (score, total) => { const pc = total ? score / total * 100 : 0; return pc >= 90 ? 1 : pc >= 80 ? 2 : pc >= 70 ? 3 : pc >= 60 ? 4 : pc >= 50 ? 5 : pc >= 40 ? 6 : pc >= 30 ? 7 : pc >= 20 ? 8 : 9; };
export function gradeOf(cfg, score, total) {
  const g = cfg.grade || {};
  if (g.mode === "cut") { const cuts = (g.cuts || []).map(num).filter(x => x > 0).sort((a, b) => b - a); if (!cuts.length) return null;
    const i = cuts.findIndex(c => score >= c), n = i < 0 ? cuts.length + 1 : i + 1; return { n, label: `${n}등급`, note: "선생님 커트라인 기준", toTop: cuts[0] > score ? r1(cuts[0] - score) : 0 }; }
  if (g.mode === "score") return null;
  const n = csatGrade(score, total); return { n, label: `${n}등급`, note: "절대평가", toTop: n > 1 ? r1(Math.max(0, total * 0.9 - score)) : 0 };
}
/* 시험 하나 전체 채점 */
export function scoreExam(exam, sheets) {
  const cfg = exam.cfg || {}, items = (cfg.items || []).filter(it => it.t === "s" || String(it.a || "").trim());
  const total = r1(items.reduce((s, it) => s + num(it.p), 0));
  const done = sheets.filter(s => s.confirmed);
  const per = done.map(sh => { const rows = items.map(it => ({ it, area: areaOf(it), ...itemScore(it, sh) })); return { student: sh.student, sh, rows, score: r1(rows.reduce((s, r) => s + r.got, 0)) }; });
  per.forEach(p => { p.rank = 1 + per.filter(q => q.score > p.score).length; });
  const n = per.length, avg = n ? r1(per.reduce((s, p) => s + p.score, 0) / n) : 0, max = n ? Math.max(...per.map(p => p.score)) : 0, min = n ? Math.min(...per.map(p => p.score)) : 0;
  const itemRate = {}; items.forEach(it => { const g = per.map(p => p.rows.find(r => r.it.n === it.n)); itemRate[it.n] = n ? Math.round(g.reduce((s, r) => s + (r.max ? r.got / r.max : 0), 0) / n * 100) : null; });
  const areasOf = rows => { const o = {}; rows.forEach(r => { const k = r.area; (o[k] = o[k] || { a: k, got: 0, max: 0, n: 0, ok: 0 }); o[k].got += r.got; o[k].max += r.max; o[k].n++; if (r.ok) o[k].ok++; }); return o; };
  const clsAreas = {}; per.forEach(p => Object.values(areasOf(p.rows)).forEach(k => { (clsAreas[k.a] = clsAreas[k.a] || { got: 0, max: 0 }); clsAreas[k.a].got += k.got; clsAreas[k.a].max += k.max; }));
  return { items, total, per, n, avg, max, min, itemRate, areasOf, clsAreas };
}
const pct1 = (a, b) => b ? a / b * 100 : 0;

/* 총평 (선생님 템플릿 그대로 — 사실만) */
export function templateComment(d) {
  const nm = d.name, A = d.areas.filter(a => a.max > 0);
  if (!A.length) return "";
  const best = d.strong[0] || [...A].sort((a, b) => b.pct - a.pct)[0], worst = d.weak[0], lost = [...A].sort((a, b) => (b.max - b.got) - (a.max - a.got))[0];
  const L = [];
  L.push(`${nm} 학생은 이번 시험에서 ${d.score}점${d.grade ? `(${d.grade.label})` : ""}, 응시생 ${d.allN}명 중 ${d.allRank}위(상위 ${d.topPct}%)를 기록했습니다.`);
  if (best) L.push(best.pct >= 75 ? `${best.a} 영역은 정답률 ${best.pct}%로 가장 안정적으로 자리 잡았습니다.`
    : `${best.a} 영역은 정답률 ${best.pct}%로 상대적으로 가장 나은 편이나, 이 영역도 아직 절대적인 수준은 아닙니다.`);
  if (worst) L.push(`반면 ${worst.a} 영역은 정답률 ${worst.pct}%로 가장 낮았고` + (lost && lost.max - lost.got > 0
    ? (lost.a === worst.a ? `, 이 영역에서만 ${r1(lost.max - lost.got)}점을 잃어 실점도 가장 컸습니다.` : `, 실점이 가장 큰 영역은 ${lost.a}로 이 영역에서만 ${r1(lost.max - lost.got)}점을 잃었습니다.`) : ".")) ;
  const pri = d.wrong.filter(w => w.pri).length;
  if (d.wrong.length) L.push(pri ? `특히 반 학생 70% 이상이 맞힌 문항 ${pri}개를 놓쳤는데, 이는 실력보다 풀이 절차나 시간 배분의 문제일 가능성이 높아 우선적으로 점검하겠습니다.`
    : `반 전체가 어려워한 문항 위주로 틀려, 기본기는 유지되고 있습니다.`);
  if (worst) L.push(`2페이지의 학습 처방을 2주간 적용한 뒤, 다음 모의고사에서 ${worst.a} 정답률 ${Math.min(95, Math.max(worst.pct + 15, 60))}% 도달을 1차 목표로 삼겠습니다.`);
  return L.join(" ");
}

/* 학생 한 명 리포트 데이터 */
export async function reportData(exam, sheets, student, cls) {
  const S = scoreExam(exam, sheets), me = S.per.find(p => p.student === student);
  if (!me) return null;
  const cfg = exam.cfg || {}, g = gradeOf(cfg, me.score, S.total);
  // 전체 = 같은 시험 이름·날짜로 본 모든 반 (반이 하나면 반과 같음)
  let allPer = S.per.map(p => ({ score: p.score, cls: cls || "" })), allSum = null;
  const sibs = await sql`select e.id, e.cfg, e.class_id, c.name as cls from mock_exams e left join hw_classes c on c.id = e.class_id where e.title = ${exam.title} and e.day = ${exam.day} and e.id <> ${exam.id}`;
  for (const o of sibs) { const sh = await sql`select student, marks, subs, confirmed from mock_sheets where exam_id = ${o.id}`; scoreExam(o, sh).per.forEach(p => allPer.push({ score: p.score, cls: o.cls })); }
  const allN = allPer.length, allRank = 1 + allPer.filter(p => p.score > me.score).length, allAvg = allN ? r1(allPer.reduce((s, p) => s + p.score, 0) / allN) : 0;
  // 영역별 (본인 · 반 평균 · 지난 시험 대비)
  const mine = S.areasOf(me.rows);
  // 지난 동형모고 (같은 학생, 이 시험 전)
  const others = await sql`select e.id, e.title, e.day, e.cfg from mock_exams e join mock_sheets s on s.exam_id = e.id
                           where s.student = ${student} and s.confirmed and (e.day < ${exam.day} or (e.day = ${exam.day} and e.id < ${exam.id})) order by e.day, e.id`;
  const trend = []; let prevAreas = null;
  for (const o of others.slice(-7)) {
    const sh = await sql`select student, marks, subs, confirmed from mock_sheets where exam_id = ${o.id}`;
    const T = scoreExam(o, sh), p = T.per.find(x => x.student === student); if (!p) continue;
    trend.push({ id: o.id, title: o.title, day: o.day, pct: T.total ? Math.round(p.score / T.total * 100) : 0, score: p.score, total: T.total, rank: p.rank, n: T.n });
    prevAreas = T.areasOf(p.rows);
  }
  trend.push({ id: exam.id, title: exam.title, day: exam.day, pct: S.total ? Math.round(me.score / S.total * 100) : 0, score: me.score, total: S.total, rank: me.rank, n: S.n, cur: true });
  const areas = AREAS_ALL.filter(a => mine[a]).map(a => { const m = mine[a], c = S.clsAreas[a], pv = prevAreas && prevAreas[a];
    const pct = r1(pct1(m.got, m.max)), cl = c && c.max ? r1(pct1(c.got, c.max)) : null;
    return { a, n: m.n, ok: m.ok, got: r1(m.got), max: r1(m.max), pct, cls: cl, gap: cl == null ? null : r1(pct - cl), delta: pv && pv.max ? r1(pct - pct1(pv.got, pv.max)) : null }; });
  // 강점/약점: 절대 정답률 기준, 동점이면 반평균 격차
  const asc = [...areas].sort((x, y) => x.pct - y.pct || (x.gap ?? 0) - (y.gap ?? 0));
  const k = Math.min(3, Math.floor(areas.length / 2) || 1);
  const weak = asc.slice(0, k), strong = asc.slice(-k).reverse().filter(a => !weak.includes(a) && !(a.gap != null && a.gap < 0));   // 강점 카드에 반평균보다 낮은 영역은 넣지 않음
  const items = me.rows.map(r => ({ n: r.it.n, t: r.it.t || "o", d: r.area, k: r.it.k || "", p: num(r.it.p), a: r.it.a || "", mark: r.mark, got: r.got, ok: r.ok, part: !!r.part,
    rate: S.itemRate[r.it.n], e: r.it.e || "", m: r.it.m || "", why: r.it.t === "s" ? (((me.sh.subs || {})[r.it.n] || {}).why || "") : "" }));
  const wrong = items.filter(i => !i.ok).map(i => ({ ...i, pri: (i.rate ?? 0) >= 70 }));
  const d = {
    exam: { id: exam.id, title: exam.title, day: exam.day, cls: cls || "", academy: cfg.academy || "헤이즐 영어", total: S.total, nQ: S.items.length, nObj: S.items.filter(i => i.t !== "s").length, nSub: S.items.filter(i => i.t === "s").length },
    student, name: baseName(student), score: me.score, total: S.total, pct: S.total ? Math.round(me.score / S.total * 100) : 0,
    grade: g, rank: me.rank, n: S.n, avg: S.avg, max: S.max, min: S.min,
    allRank, allN, allAvg, topPct: allN ? (allRank / allN * 100).toFixed(1) : "0.0",
    areas, strong, weak, items, wrong, trend,
    rx: weak.map(a => ({ a: a.a, pct: a.pct, gap: a.gap, head: (RX[a.a] || RX["대의파악"])[0], list: (RX[a.a] || RX["대의파악"])[1] })),
    comment: me.sh.comment || {}
  };
  d.template = templateComment(d);
  return d;
}
export async function loadExam(id) {
  const [e] = await sql`select e.*, c.name as cls from mock_exams e left join hw_classes c on c.id = e.class_id where e.id = ${id}`;
  return e || null;
}
