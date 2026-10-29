// 조교 입력시트 '인터뷰기록' 탭 → 학생별 인터뷰 기록
export const AREAS = ["독해", "어휘", "어법", "오답·교재"];
const S = v => String(v ?? "").replace(/\s+/g, " ").trim();
export function normGrade(v) {
  const s = S(v).toUpperCase();
  if (!s) return "";
  if (/미완/.test(s)) return "미완";
  if (/미검사|검사\s*안/.test(s)) return "미검사";
  const m = s.match(/^[ABCD]/); return m ? m[0] : s.slice(0, 4);
}
// 인터뷰일자 → YYYY-MM-DD (시트 날짜 일련번호, '9/29', '9.29', '2026-09-29', '9월 29일' 모두)
export function normDay(v, today) {
  if (v === "" || v == null) return "";
  if (typeof v === "number" && v > 20000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const n = String(v).match(/\d+/g); if (!n) return "";
  let y, m, d;
  if (n.length >= 3 && n[0].length === 4) [y, m, d] = n;
  else if (n.length >= 3 && n[2].length === 4) [m, d, y] = n;
  else [m, d] = n;
  y = y || (today || "").slice(0, 4) || String(new Date().getFullYear());
  m = +m; d = +d; if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function parseSheet(values, today) {
  // 헤더 줄 = '이름' 칸이 있는 줄
  const hi = values.findIndex(r => (r || []).some(c => S(c) === "이름"));
  if (hi < 0) return { rows: [], error: "'이름' 머리줄을 못 찾았어요" };
  const H = values[hi].map(S), col = name => H.indexOf(name);
  const get = (r, name) => { const i = col(name); return i < 0 ? "" : r[i]; };
  const out = [];
  for (let i = hi + 1; i < values.length; i++) {
    const r = values[i] || [], name = S(get(r, "이름"));
    if (!name || /○/.test(name)) continue;            // 예시 줄 · 빈 줄
    const cur = AREAS.map(a => normGrade(get(r, a === "오답·교재" ? "오답·교재" : a)));
    const past = [1, 2, 3].map(k => AREAS.map(a => normGrade(get(r, `${k}회전 ${a}`))));
    const list = (base, n) => [1, 2, 3].map(k => S(get(r, base + k))).filter(Boolean).slice(0, n);
    const answers = [1, 2, 3].map(k => ({ q: S(get(r, `학생답변${k}`)), ctx: S(get(r, `학생답변${k}맥락`)) })).filter(x => x.q);
    const missionsPrev = [1, 2, 3].map(k => ({ t: S(get(r, `지난미션${k}`)), r: S(get(r, `지난미션${k}결과`)).toUpperCase() })).filter(x => x.t);
    const fills = [1, 2, 3].map(k => S(get(r, `보완${k}`))).filter(Boolean).map(t => { const p = t.split("::"); return p.length > 1 ? { area: S(p[0]), text: S(p.slice(1).join("::")) } : { area: "", text: t }; });
    const roundRaw = S(get(r, "회차")), round = +((roundRaw.match(/\d+/) || [1])[0]) || 1;
    out.push({
      row: i + 1, name, cls: S(get(r, "반")), scope: S(get(r, "범위")), round,
      day: normDay(get(r, "인터뷰일자"), today), dayRaw: S(get(r, "인터뷰일자")),
      teacher: S(get(r, "담당선생님")) || "헤이즐 쌤",
      cur, past,
      title: S(get(r, "코멘트제목")), body: String(get(r, "코멘트본문") ?? "").trim(),
      answers, missionsPrev, change: S(get(r, "변화메모")), fills,
      missions: list("이번미션", 3), home: S(get(r, "가정요청")),
      // 특이사항: 머리줄에 '특이사항'(또는 특이점·관찰메모) 칸을 아무 데나 만들면 읽음 — 리포트 '인터뷰에서 본 장면' + AI 코멘트 재료
      special: String(get(r, "특이사항") || get(r, "특이점") || get(r, "관찰메모") || "").trim()
    });
  }
  return { rows: out };
}
