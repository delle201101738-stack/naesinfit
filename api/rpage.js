// 리포트 링크(/report?student=…)를 서버에서 미리 글로 채워 보냄
// → 클로드·카톡 미리보기처럼 자바스크립트를 실행하지 않는 곳에서도 내용이 바로 읽힘
import { sql, ensure } from "./_db.js";

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

async function build(student, dayQ) {
  await ensure();
  const rows = await sql`select id, book, part, part_name, scope, total, correct, created_at
                         from attempts where student = ${student} order by created_at desc limit 1000`;
  const hw = await sql`
    select i.id, i.day, i.title, i.memo, c.name as class_name, k.status, k.score, k.memo as cmemo,
           (select count(*)::int from hw_members m2 where m2.class_id = i.class_id) as n,
           (select count(*)::int from hw_checks k2 where k2.item_id = i.id and k2.status = 'done') as nd
    from hw_members m join hw_items i on i.class_id = m.class_id join hw_classes c on c.id = m.class_id
    left join hw_checks k on k.item_id = i.id and k.student = m.student
    where m.student = ${student} order by i.day desc, i.id asc limit 200`;
  const today = kday(Date.now());
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayQ || "") ? dayQ : today;
  const cls = hw[0] ? hw[0].class_name : "";
  const S = daySummary(rows, hw, day);
  const days = [...new Set(rows.map(r => kday(r.created_at)).concat(hw.map(h => h.day)))].filter(d => d <= day).sort();
  const hist = days.map(d => daySummary(rows, hw, d));
  const before = hist.filter(x => x.d < day).reverse();
  const pt = before.find(x => x.tp !== null), ph = before.find(x => x.hp !== null);

  // 반평균: 같은 과·같은 시험·같은 날 본 학생들 (학생마다 최고 기록)
  let avg = {};
  if (S.tests.length) {
    const books = [...new Set(rows.map(r => r.book))];
    const A = await sql`
      with x as (select student, book, part, total, correct, to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day
                 from attempts where scope <> '재시험' and total > 0 and book = any(${books})),
           b as (select distinct on (student, book, part, day) student, book, part, day, total, correct
                 from x where day = ${day} order by student, book, part, day, (correct::float / total) desc)
      select book, part, count(*)::int as s, round(avg(correct * 100.0 / total))::int as p from b group by book, part`;
    A.forEach(a => { if (a.s >= 2) avg[bk(a.book) + "|" + a.part] = a; });
  }
  const wrong = S.tests.length ? await sql`
    select a.part_name, d->>'m' as m, d->>'r' as r
    from attempts a, jsonb_array_elements(a.detail) it, jsonb_array_elements(it->'d') d
    where a.student = ${student} and (d->>'ok') = '0' and a.scope <> '재시험'
      and to_char(a.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') = ${day}
    limit 25` : [];

  const L = [];
  L.push(`<h1>${esc(student)} · ${fmt(day)} 숙제·테스트 리포트</h1>`);
  L.push(`<p>hazel_studylog · ${cls ? esc(cls) + " · " : ""}이 날짜의 기록만 담았습니다.</p>`);
  if (!S.tests.length && !S.hw.length) {
    L.push(`<p><b>${fmt(day)}에는 시험·숙제 기록이 없습니다.</b> (예전 날짜 기록은 섞지 않습니다)</p>`);
  } else {
    L.push(`<h2>요약</h2><ul>`);
    L.push(`<li>숙제: ${S.hw.length ? (S.hc ? `${S.hd}/${S.hc} 완료 (${S.hp}%)` : `${S.hw.length}개 · 아직 검사 전`) : "없음"}${ph && S.hp !== null ? ` · 지난 학습일(${fmt(ph.d)}) ${ph.hp}% 대비 ${pm(S.hp - ph.hp)}` : ""}</li>`);
    L.push(`<li>시험: ${S.tests.length ? `${S.tests.length}개 · 정답률 ${S.tp}% (${S.c}/${S.t})` : "없음"}${pt && S.tp !== null ? ` · 지난 학습일(${fmt(pt.d)}) ${pt.tp}% 대비 ${pm(S.tp - pt.tp)}` : ""}</li></ul>`);
    if (S.hw.length) {
      L.push(`<h2>숙제 검사</h2><ul>`);
      S.hw.forEach(h => L.push(`<li>${ST[h.status] || "⏺ 미검사"} — ${esc(h.title)}${h.memo ? ` (${esc(h.memo)})` : ""}${h.score != null ? ` · ${h.score}점` : ""}${h.cmemo ? ` · 선생님 메모: ${esc(h.cmemo)}` : ""}${h.n ? ` · 반 완료 ${h.nd}/${h.n}` : ""}</li>`));
      L.push(`</ul>`);
      const miss = S.hw.filter(h => h.status === "part" || h.status === "none");
      if (miss.length) L.push(`<p><b>다시 해 올 숙제 ${miss.length}개:</b> ${miss.map(h => esc(h.title)).join(" / ")}</p>`);
    }
    if (S.tests.length) {
      L.push(`<h2>시험 결과</h2><table border="1" cellpadding="4"><tr><th>과</th><th>시험</th><th>맞힌 수</th><th>정답률</th><th>반평균</th></tr>`);
      S.tests.forEach(x => { const a = avg[x.book + "|" + x.part];
        L.push(`<tr><td>${esc(x.book.split(" · ").pop())}</td><td>${esc(x.name)}</td><td>${x.c}/${x.t}</td><td>${Math.round(x.r * 100)}%</td><td>${a ? `${a.p}% (${a.s}명)` : "—"}</td></tr>`); });
      L.push(`</table>`);
      if (wrong.length) {
        L.push(`<h2>이날 틀린 문항 (일부)</h2><ul>`);
        wrong.filter(w => w.m && w.r).slice(0, 20).forEach(w => L.push(`<li>[${esc(w.part_name)}] ${esc(String(w.m).slice(0, 60))} → ${esc(String(w.r).slice(0, 80))}</li>`));
        L.push(`</ul>`);
      }
    }
  }
  const H8 = hist.slice(-8).reverse();
  if (H8.length) {
    L.push(`<h2>누적 기록 (최근 ${H8.length}번 학습일 · 날짜별로 따로 계산)</h2><table border="1" cellpadding="4"><tr><th>날짜</th><th>숙제 완료</th><th>시험 정답률</th><th>본 과</th></tr>`);
    H8.forEach(x => L.push(`<tr><td>${fmt(x.d)}</td><td>${x.hc ? `${x.hd}/${x.hc} (${x.hp}%)` : x.hw.length ? "미검사" : "—"}</td><td>${x.tp !== null ? `${x.tp}% (${x.tests.length}개)` : "—"}</td><td>${esc([...new Set(x.tests.map(t => t.book.split(" · ").pop()))].join(", "))}</td></tr>`));
    L.push(`</table>`);
  }
  return { html: L.join("\n"), title: `${student} · ${fmt(day)} 숙제·테스트 리포트`, desc: `숙제 ${S.hc ? `${S.hd}/${S.hc}` : "-"} · 시험 ${S.tp !== null ? S.tp + "%" : "-"}` };
}

export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const student = (u.searchParams.get("student") || "").trim().slice(0, 20);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  let page = "";
  try { page = await (await fetch(`https://${host}/report`, { cache: "no-store" })).text(); } catch (e) {}
  let ssr = "", title = "", desc = "";
  if (student) {
    try { const r = await build(student, u.searchParams.get("day")); ssr = r.html; title = r.title; desc = r.desc; }
    catch (e) { console.error("[rpage]", e); ssr = `<p>${esc(student)} 리포트를 불러오지 못했습니다.</p>`; }
  }
  if (!page) page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="gate"></div></body></html>`;
  if (title) page = page.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`);
  page = page.replace(/<div id="gate"/, `<article id="ssr" style="max-width:720px;margin:24px auto;padding:0 18px;font-size:14px;line-height:1.7">${ssr}</article><div id="gate"`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(page);
}
