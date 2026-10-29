// 리포트 링크(/report?student=…)를 서버에서 미리 글로 채워 보냄
// → 클로드·카톡 미리보기처럼 자바스크립트를 실행하지 않는 곳에서도 내용이 바로 읽힘
import { sql, ensure } from "./_db.js";
import { PNAME } from "./_pname.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kday = v => new Date(new Date(v).getTime() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
const bk = b => String(b || "").replace(/\s*올킬\s*$/, "").trim();
const isRe = x => x.scope === "재시험" || /^오답노트/.test(x.part_name || "");
const fmt = d => { const [y, m, dd] = d.split("-"); return `${y}.${m}.${dd} (${"일월화수목금토"[new Date(+y, +m - 1, +dd).getDay()]})`; };
const ST = { done: "✅ 완료", part: "🟡 일부", none: "❌ 안 함", skip: "➖ 면제" };
const pm = v => v == null ? "" : v > 0 ? `▲ ${v}%p` : v < 0 ? `▼ ${-v}%p` : "변화 없음";

function daySummary(rows, hw, d) {
  const best = {};
  rows.filter(x => kday(x.created_at) === d && !isRe(x)).forEach(x => {
    const k = bk(x.book) + "|" + x.part, r = x.total ? x.correct / x.total : 0;
    if (!best[k] || r > best[k].r) best[k] = { book: bk(x.book), part: x.part, name: x.part_name, t: x.total, c: x.correct, r };
  });
  const v = Object.values(best), t = v.reduce((a, x) => a + x.t, 0), c = v.reduce((a, x) => a + x.c, 0);
  const hs = hw.filter(h => h.day === d), hc = hs.filter(h => h.status && h.status !== "skip"), hd = hc.filter(h => h.status === "done").length;
  return { d, tests: v, tp: t ? Math.round(c / t * 100) : null, t, c, hw: hs, hc: hc.length, hd, hp: hc.length ? Math.round(hd / hc.length * 100) : null };
}

const pname = (id, fb) => PNAME[id] || fb || id;
const pt2 = v => v == null ? "" : v > 0 ? `▲ ${v}점` : v < 0 ? `▼ ${-v}점` : "지난번과 같음";
const dPlus = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dDiff = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 864e5);

async function build(student, dayQ, range) {
  await ensure();
  const rows = await sql`select id, book, part, part_name, scope, total, correct, created_at
                         from attempts where student = ${student} order by created_at desc limit 1000`;
  const hw = await sql`
    select i.id, i.day, i.title, i.memo, c.name as class_name, k.status, k.score, k.memo as cmemo,
           (select count(*)::int from hw_members m2 where m2.class_id = i.class_id) as n,
           (select count(*)::int from hw_checks k2 where k2.item_id = i.id and k2.status = 'done') as nd
    from hw_members m join hw_items i on i.class_id = m.class_id join hw_classes c on c.id = m.class_id
    left join hw_checks k on k.item_id = i.id and k.student = m.student
    where m.student = ${student} order by i.day desc, i.id asc limit 300`;
  const klass = await sql`select c.name, c.exam_date, c.exam_name from hw_members m join hw_classes c on c.id = m.class_id where m.student = ${student}`;
  const notes = await sql`select day, kind, headline, note from report_notes where student = ${student}`;
  const today = kday(Date.now());
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayQ || "") ? dayQ : today;
  const cls = klass[0] ? klass[0].name : (hw[0] ? hw[0].class_name : "");
  const L = [];
  const noteOf = kind => notes.find(n => n.day === day && n.kind === kind);
  const [, mm, dd] = day.split("-");
  const exam = klass.find(k => k.exam_date && k.exam_date >= day);
  const dday = exam ? dDiff(exam.exam_date, day) : null;
  const todo = () => {   // 다음에 할 일: 다시 해 올 숙제 + 다음 숙제 + 시험 D-day
    const redo = hw.filter(h => h.day <= day && (h.status === "part" || h.status === "none")).slice(0, 6);
    const nextDay = hw.filter(h => h.day > day).map(h => h.day).sort()[0];
    const next = nextDay ? hw.filter(h => h.day === nextDay) : [];
    const T = [];
    if (redo.length) T.push(`<li>📌 다시 해 올 숙제: ${redo.map(h => esc(h.title)).join(" / ")}</li>`);
    if (next.length) T.push(`<li>📚 다음 숙제 (${fmt(nextDay)} 검사): ${next.map(h => esc(h.title)).join(" / ")}</li>`);
    if (exam) T.push(`<li>🗓 ${esc(exam.exam_name || "내신 시험")}: ${fmt(exam.exam_date)} · D-${dday}</li>`);
    return T.length ? `<h2>다음에 할 일</h2><ul>${T.join("")}</ul>` : "";
  };

  if (range === "week" || range === "month") {
    const n = range === "week" ? 7 : 30, from = dPlus(day, -(n - 1));
    const ds = [...new Set(rows.map(r => kday(r.created_at)).concat(hw.map(h => h.day)))].filter(d => d >= from && d <= day).sort();
    const H = ds.map(d => daySummary(rows, hw, d));
    const hc = H.reduce((a, x) => a + x.hc, 0), hd = H.reduce((a, x) => a + x.hd, 0), t = H.reduce((a, x) => a + x.t, 0), c = H.reduce((a, x) => a + x.c, 0);
    const re = rows.filter(r => isRe(r) && kday(r.created_at) >= from && kday(r.created_at) <= day).length;
    const nt = notes.find(x => x.day === day && x.kind === range);
    L.push(`<h1>${esc(student)} · ${range === "week" ? "주간" : "월간"} 학습리포트 (${fmt(from)} ~ ${fmt(day)})</h1>`);
    L.push(`<p>hazel_studylog · ${esc(cls)}</p>`);
    if (nt && nt.headline) L.push(`<p><b>선생님 한마디:</b> ${esc(nt.headline)}</p>`);
    L.push(`<h2>요약</h2><ul><li>학습한 날: ${ds.length}일</li><li>숙제 완료: ${hc ? `${hd}/${hc} (${Math.round(hd / hc * 100)}%)` : "검사한 숙제 없음"}</li>`
      + `<li>시험 평균 정답률: ${t ? `${Math.round(c / t * 100)}% (${c}/${t})` : "시험 없음"}</li><li>틀린 문제 다시 풀기: ${re}회</li></ul>`);
    L.push(`<h2>날짜별 기록</h2><table border="1" cellpadding="4"><tr><th>날짜</th><th>숙제 완료</th><th>시험 정답률</th></tr>`
      + H.slice().reverse().map(x => `<tr><td>${fmt(x.d)}</td><td>${x.hc ? `${x.hd}/${x.hc}` : x.hw.length ? "검사 전" : "—"}</td><td>${x.tp !== null ? `${x.tp}% (${x.tests.length}개)` : "—"}</td></tr>`).join("") + `</table>`);
    if (nt && nt.note) L.push(`<h2>선생님 코멘트</h2><p>${esc(nt.note).replace(/\n/g, "<br>")}</p>`);
    L.push(todo());
    const title = `${student} · ${range === "week" ? "주간" : "월간"} 학습리포트 (~${mm}.${dd})`;
    return { html: L.join("\n"), title, desc: `${cls ? cls + " · " : ""}숙제 ${hc ? Math.round(hd / hc * 100) + "%" : "-"} · 시험 평균 ${t ? Math.round(c / t * 100) + "%" : "-"}` };
  }

  const S = daySummary(rows, hw, day);
  const days = [...new Set(rows.map(r => kday(r.created_at)).concat(hw.map(h => h.day)))].filter(d => d <= day).sort();
  const hist = days.map(d => daySummary(rows, hw, d));
  const before = hist.filter(x => x.d < day).reverse();
  const pt = before.find(x => x.tp !== null), ph = before.find(x => x.hp !== null);
  const retake = rows.filter(r => isRe(r) && kday(r.created_at) >= day);

  // 반평균: 같은 과·같은 시험·같은 날 본 학생들 (학생마다 최고 기록) — 3명 이상일 때만
  let avg = {};
  if (S.tests.length) {
    const books = [...new Set(rows.map(r => r.book))];
    const A = await sql`
      with x as (select student, book, part, total, correct, to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day
                 from attempts where scope <> '재시험' and total > 0 and book = any(${books})),
           b as (select distinct on (student, book, part, day) student, book, part, day, total, correct
                 from x where day = ${day} order by student, book, part, day, (correct::float / total) desc)
      select book, part, count(*)::int as s, round(avg(correct * 100.0 / total))::int as p from b group by book, part`;
    A.forEach(a => { if (a.s >= 3) avg[bk(a.book) + "|" + a.part] = a; });
  }
  const nt = noteOf("day");
  L.push(`<h1>${esc(student)} · ${mm}.${dd}일자 학습리포트</h1>`);
  L.push(`<p>hazel_studylog · ${cls ? esc(cls) + " · " : ""}${fmt(day)} 기록만 담았습니다.</p>`);
  if (nt && nt.headline) L.push(`<p><b>선생님 한마디:</b> ${esc(nt.headline)}</p>`);
  if (!S.tests.length && !S.hw.length) {
    L.push(`<p><b>${fmt(day)}에는 시험·숙제 기록이 없습니다.</b></p>`);
  } else {
    L.push(`<h2>요약</h2><ul>`);
    L.push(`<li>숙제: ${S.hw.length ? (S.hc ? `${S.hd}/${S.hc} 완료` : `${S.hw.length}개 · 아직 검사 전`) : "없음"}${ph && S.hp !== null ? ` (지난번 ${ph.hp}% → 이번 ${S.hp}%)` : ""}</li>`);
    L.push(`<li>시험: ${S.tests.length ? `${S.tests.length}개 · 정답률 ${S.tp}%` : "없음"}${pt && S.tp !== null ? ` · 지난 학습일(${fmt(pt.d)})보다 ${pt2(S.tp - pt.tp)}` : ""}</li>`);
    L.push(`<li>틀린 문제 다시 풀기: ${retake.length ? `${retake.length}회 (마지막 ${Math.round(retake[0].correct / Math.max(1, retake[0].total) * 100)}%)` : "아직 안 함"}</li></ul>`);
    if (S.hw.length) {
      L.push(`<h2>숙제</h2><ul>`);
      S.hw.forEach(h => L.push(`<li>${ST[h.status] || "⏺ 검사 전"} — ${esc(h.title)}${h.score != null ? ` · ${h.score}점` : ""}${h.cmemo ? ` · 선생님 메모: ${esc(h.cmemo)}` : ""}</li>`));
      L.push(`</ul>`);
    }
    if (S.tests.length) {
      L.push(`<h2>시험 결과</h2><table border="1" cellpadding="4"><tr><th>시험</th><th>맞힌 수</th><th>정답률</th><th>반평균</th></tr>`);
      S.tests.forEach(x => { const a = avg[x.book + "|" + x.part];
        L.push(`<tr><td>${esc(pname(x.part, x.name))} (${esc(x.book.split(" · ").pop())})</td><td>${x.c}/${x.t}</td><td>${Math.round(x.r * 100)}%</td><td>${a ? `${a.p}% (${a.s}명)` : "—"}</td></tr>`); });
      L.push(`</table>`);
    }
  }
  if (nt && nt.note) L.push(`<h2>선생님 코멘트</h2><p>${esc(nt.note).replace(/\n/g, "<br>")}</p>`);
  L.push(todo());
  const H8 = hist.slice(-8).reverse();
  if (H8.length > 1) {
    L.push(`<h2>최근 기록 (날짜별)</h2><table border="1" cellpadding="4"><tr><th>날짜</th><th>숙제 완료</th><th>시험 정답률</th></tr>`);
    H8.forEach(x => L.push(`<tr><td>${fmt(x.d)}</td><td>${x.hc ? `${x.hd}/${x.hc}` : x.hw.length ? "검사 전" : "—"}</td><td>${x.tp !== null ? `${x.tp}% (${x.tests.length}개)` : "—"}</td></tr>`));
    L.push(`</table>`);
  }
  const desc = [S.hw.length ? (S.hc ? `숙제 ${S.hd}/${S.hc} 완료` : `숙제 ${S.hw.length}개`) : "",
                S.tests.length ? `시험 정답률 ${S.tp}%` : "",
                (pt && S.tp !== null) ? `지난번보다 ${pt2(S.tp - pt.tp)}` : "",
                dday !== null ? `시험 D-${dday}` : ""].filter(Boolean).join(" · ") || "숙제·테스트 결과";
  return { html: L.join("\n"), title: `${student} · ${mm}.${dd}일자 학습리포트`, desc: `${cls ? cls + " · " : ""}${desc}` };
}

export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const tok = (u.searchParams.get("t") || "").trim().slice(0, 40);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  let page = "";
  try { page = await (await fetch(`https://${host}/report`, { cache: "no-store" })).text(); } catch (e) {}
  let ssr = "", title = "", desc = "";
  // 학부모 링크는 비공개 토큰(/r/토큰)으로만 열림 — 이름만으로는 남의 리포트를 볼 수 없음
  if (tok) {
    try {
      await ensure();
      const [m] = await sql`select student from report_tokens where token = ${tok}`;
      if (!m) ssr = `<p>리포트 링크가 올바르지 않아요. 선생님께 새 링크를 받아 주세요.</p>`;
      else { const r = await build(m.student, u.searchParams.get("day"), u.searchParams.get("range")); ssr = r.html; title = r.title; desc = r.desc; }
    } catch (e) { console.error("[rpage]", e); ssr = `<p>리포트를 불러오지 못했습니다.</p>`; }
  } else if (u.searchParams.get("student")) {
    ssr = `<p>이 링크는 더 이상 쓰지 않아요. 선생님께 새 리포트 링크를 받아 주세요.</p>`;
  }
  if (!page) page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="gate"></div></body></html>`;
  // 카톡 미리보기: 제목 · 설명 · 썸네일(헤이즐쌤 사진, /og.jpg 1200x630)
  const og = `https://${host}/og.jpg`, url = `https://${host}/r/${encodeURIComponent(tok)}${u.searchParams.get("day") ? "?day=" + u.searchParams.get("day") : ""}`;
  if (title) page = page.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="헤이즐쌤 학습리포트">`
    + `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`
    + `<meta property="og:image" content="${og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`
    + `<meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">`);
  page = page.replace(/<div id="gate"/, () => `<article id="ssr" style="max-width:720px;margin:24px auto;padding:0 18px;font-size:14px;line-height:1.7">${ssr}</article><div id="gate"`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(page);
}
