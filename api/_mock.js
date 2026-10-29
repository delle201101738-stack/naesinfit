// 동형모고 OMR — 표 · 채점 · 리포트 데이터 (api/mock.js · api/rpage.js 가 같이 씀)
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

export const KINDS = ["목적", "심경·분위기", "주장", "함축 의미", "요지", "주제", "제목", "도표", "내용 일치", "안내문", "어법", "어휘", "빈칸", "흐름 무관", "순서", "삽입", "요약", "장문", "지칭", "영영 풀이", "연결어", "기타",
  "서술형(영작)", "서술형(어법 고치기)", "서술형(빈칸·어휘)", "서술형(요약·주제)", "서술형(기타)"];
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
export function gradeOf(cfg, score, total) {
  const g = cfg.grade || {};
  if (g.mode === "csat") { const pc = total ? score / total * 100 : 0; return { label: `${Math.min(9, Math.max(1, 10 - Math.floor(pc / 10)))}등급`, note: "수능 영어 절대평가 기준(100점 환산)" }; }
  if (g.mode === "cut") { const cuts = (g.cuts || []).map(num).filter(x => x > 0).sort((a, b) => b - a); if (!cuts.length) return null;
    const i = cuts.findIndex(c => score >= c); return { label: `${i < 0 ? cuts.length + 1 : i + 1}등급`, note: "선생님 커트라인 기준" }; }
  return null;
}
/* 시험 하나 전체 채점: 학생별 점수·석차·유형별 + 반 통계 */
export function scoreExam(exam, sheets) {
  const cfg = exam.cfg || {}, items = (cfg.items || []).filter(it => it.t === "s" || String(it.a || "").trim());
  const total = items.reduce((s, it) => s + num(it.p), 0);
  const done = sheets.filter(s => s.confirmed);
  const per = done.map(sh => {
    const rows = items.map(it => ({ it, ...itemScore(it, sh) }));
    const score = r1(rows.reduce((s, r) => s + r.got, 0));
    return { student: sh.student, sh, rows, score };
  });
  const sorted = [...per].sort((a, b) => b.score - a.score);
  per.forEach(p => { p.rank = 1 + sorted.filter(q => q.score > p.score).length; });
  const n = per.length, avg = n ? r1(per.reduce((s, p) => s + p.score, 0) / n) : 0, max = n ? Math.max(...per.map(p => p.score)) : 0, min = n ? Math.min(...per.map(p => p.score)) : 0;
  const itemRate = {}; items.forEach(it => { const g = per.map(p => p.rows.find(r => r.it.n === it.n)); itemRate[it.n] = n ? Math.round(g.reduce((s, r) => s + (r.max ? r.got / r.max : 0), 0) / n * 100) : null; });
  const kindsOf = rows => { const o = {}; rows.forEach(r => { const k = r.it.k || "기타"; (o[k] = o[k] || { k, got: 0, max: 0, n: 0, ok: 0 }); o[k].got += r.got; o[k].max += r.max; o[k].n++; if (r.ok) o[k].ok++; }); return o; };
  const clsKinds = {}; per.forEach(p => Object.values(kindsOf(p.rows)).forEach(k => { (clsKinds[k.k] = clsKinds[k.k] || { got: 0, max: 0 }); clsKinds[k.k].got += k.got; clsKinds[k.k].max += k.max; }));
  return { items, total, per, n, avg, max, min, itemRate, kindsOf, clsKinds };
}
/* 학생 한 명 리포트 데이터 */
export async function reportData(exam, sheets, student, cls) {
  const S = scoreExam(exam, sheets), me = S.per.find(p => p.student === student);
  if (!me) return null;
  const cfg = exam.cfg || {}, g = gradeOf(cfg, me.score, S.total);
  const mk = S.kindsOf(me.rows);
  const kinds = Object.values(mk).map(k => ({ k: k.k, n: k.n, ok: k.ok, pct: k.max ? Math.round(k.got / k.max * 100) : 0,
    cls: S.clsKinds[k.k] && S.clsKinds[k.k].max ? Math.round(S.clsKinds[k.k].got / S.clsKinds[k.k].max * 100) : null }));
  kinds.sort((a, b) => KINDS.indexOf(a.k) - KINDS.indexOf(b.k));
  const items = me.rows.map(r => ({ n: r.it.n, t: r.it.t || "o", k: r.it.k || "", p: num(r.it.p), a: r.it.a || "", mark: r.mark, got: r.got, ok: r.ok, part: !!r.part,
    rate: S.itemRate[r.it.n], e: r.it.e || "", m: r.it.m || "", why: r.it.t === "s" ? (((me.sh.subs || {})[r.it.n] || {}).why || "") : "" }));
  // 누적: 이 학생이 본 다른 동형모고
  const others = await sql`select e.id, e.title, e.day, e.class_id, e.cfg from mock_exams e join mock_sheets s on s.exam_id = e.id
                           where s.student = ${student} and s.confirmed and e.day <= ${exam.day} order by e.day, e.id`;
  const trend = [];
  for (const o of others.slice(-8)) {
    if (+o.id === +exam.id) { trend.push({ id: o.id, title: o.title, day: o.day, pct: S.total ? Math.round(me.score / S.total * 100) : 0, score: me.score, total: S.total, rank: me.rank, n: S.n, cur: true }); continue; }
    const sh = await sql`select student, marks, subs, confirmed from mock_sheets where exam_id = ${o.id}`;
    const T = scoreExam(o, sh), p = T.per.find(x => x.student === student);
    if (p) trend.push({ id: o.id, title: o.title, day: o.day, pct: T.total ? Math.round(p.score / T.total * 100) : 0, score: p.score, total: T.total, rank: p.rank, n: T.n });
  }
  return {
    exam: { id: exam.id, title: exam.title, day: exam.day, cls: cls || "", total: S.total, nObj: S.items.filter(i => i.t !== "s").length, nSub: S.items.filter(i => i.t === "s").length },
    student, name: baseName(student), score: me.score, total: S.total, pct: S.total ? Math.round(me.score / S.total * 100) : 0,
    grade: g, rank: me.rank, n: S.n, avg: S.avg, max: S.max, min: S.min,
    kinds, items, trend, comment: me.sh.comment || {}
  };
}
export async function loadExam(id) {
  const [e] = await sql`select e.*, c.name as cls from mock_exams e left join hw_classes c on c.id = e.class_id where e.id = ${id}`;
  return e || null;
}
