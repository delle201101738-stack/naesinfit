/* 헤이즐's 동형모고 전용 OMR — 양식(좌표) · PDF 만들기 · 사진/스캔 인식
   모든 좌표는 A4(210×297mm) 기준 mm. 네 모서리 검은 네모를 찾아 원근 보정(호모그래피) 후 좌표대로 읽음.
   ▸ 맨 아래 코드 줄(24칸) = [1,0, 시험번호 6비트, 학생 코드 10비트, 쪽 2비트, 패리티 2, 1,1] → 어느 학생·몇 쪽인지
   ▸ 오른쪽 위 QR = "HZM|시험id|학생코드|쪽" (코드 줄이 지워졌을 때 보조) */
(function (G) {
  "use strict";
  const W = 210, H = 297, MK = 8;
  const MARK = [[12, 12], [198, 12], [198, 285], [12, 285]];          // 시계 방향 TL TR BR BL
  const CODE_Y = 285, CODE_X0 = 47.5, CODE_P = 5, CODE_S = 4, NCODE = 24;
  const QR = { x: 168, y: 18, s: 24 };
  const SUB_PER_PAGE = 8;

  /* ── 양식 좌표 ── */
  function layout(exam) {
    const items = (exam.items || []);
    const obj = items.filter(i => i.t !== "s"), sub = items.filter(i => i.t === "s");
    const pages = [];
    if (obj.length) {
      const n = obj.length, cols = n <= 20 ? 2 : n <= 45 ? 3 : 4, rows = Math.ceil(n / cols);
      const x0 = 16, x1 = 194, y0 = 62, y1 = 272;
      const gaps = Math.floor((rows - 1) / 5);
      const rp = Math.min(13, (y1 - y0 - gaps * 2.5) / rows);
      const cw = (x1 - x0) / cols, bp = Math.min(7.6, (cw - 15) / 5), bd = Math.min(4.8, bp * 0.68, rp * 0.62);
      const P = { kind: "obj", page: 0, cols, rows, rp, cw, bp, bd, items: [] };
      obj.forEach((it, k) => {
        const c = Math.floor(k / rows), r = k % rows;
        const y = y0 + rp * (r + 0.5) + Math.floor(r / 5) * 2.5, cx = x0 + c * cw;
        P.items.push({ n: it.n, label: String(it.n), y, lx: cx + 6, x0: cx, bubbles: [0, 1, 2, 3, 4].map(b => [cx + 13 + bp * (b + 0.5), y]) });
      });
      pages.push(P);
    }
    for (let s = 0; s < sub.length; s += SUB_PER_PAGE) {
      const part = sub.slice(s, s + SUB_PER_PAGE), y0 = 62, y1 = 274, gap = 3;
      const h = Math.min(60, (y1 - y0 - gap * (part.length - 1)) / part.length);
      pages.push({ kind: "sub", page: pages.length, boxes: part.map((it, k) => ({ n: it.n, label: String(it.n), pts: it.p, x: 16, y: y0 + k * (h + gap), w: 178, h })) });
    }
    return pages;
  }

  /* ── 코드 줄 ── */
  function codeBits(examId, code, page) {
    const b = [1, 0];
    for (let i = 5; i >= 0; i--) b.push((examId >> i) & 1);
    for (let i = 9; i >= 0; i--) b.push((code >> i) & 1);
    b.push((page >> 1) & 1, page & 1);
    let pa = 0, pb = 0; for (let i = 2; i < 20; i++) (i % 2 ? (pb ^= b[i]) : (pa ^= b[i]));
    b.push(pa, pb, 1, 1);
    return b;
  }
  function parseBits(b) {
    if (b.length !== NCODE || b[0] !== 1 || b[1] !== 0 || b[22] !== 1 || b[23] !== 1) return null;
    let pa = 0, pb = 0; for (let i = 2; i < 20; i++) (i % 2 ? (pb ^= b[i]) : (pa ^= b[i]));
    if (pa !== b[20] || pb !== b[21]) return null;
    let e = 0, c = 0; for (let i = 2; i < 8; i++) e = e * 2 + b[i]; for (let i = 8; i < 18; i++) c = c * 2 + b[i];
    return { exam6: e, code: c, page: b[18] * 2 + b[19] };
  }
  const codeCells = () => Array.from({ length: NCODE }, (_, i) => [CODE_X0 + i * CODE_P, CODE_Y]);

  /* ── PDF 만들기 (jsPDF 필요: 글자는 캔버스로 그려 이미지로 넣음 → 한글 깨짐 없음) ── */
  function textImg(txt, pt, opt) {
    opt = opt || {};
    const px = pt * 300 / 72, c = document.createElement("canvas"), g = c.getContext("2d");
    const font = `${opt.w || 700} ${px}px 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif`;
    g.font = font; const w = Math.ceil(g.measureText(txt).width) + 4, h = Math.ceil(px * 1.35);
    c.width = w; c.height = h; g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.font = font; g.fillStyle = opt.color || "#111"; g.textBaseline = "middle"; g.fillText(txt, 2, h / 2);
    return { url: c.toDataURL("image/jpeg", 0.92), wmm: w / 300 * 25.4, hmm: h / 300 * 25.4 };
  }
  function putText(pdf, txt, x, y, pt, opt) {   // y = 글자 가운데
    opt = opt || {}; if (!txt) return 0;
    const t = textImg(txt, pt, opt); let w = t.wmm, h = t.hmm;
    if (opt.max && w > opt.max) { h = h * opt.max / w; w = opt.max; }
    const xx = opt.align === "center" ? x - w / 2 : opt.align === "right" ? x - w : x;
    pdf.addImage(t.url, "JPEG", xx, y - h / 2, w, h); return w;
  }
  function qrImg(text) {
    if (!G.qrcode) return null;
    const q = G.qrcode(0, "M"); q.addData(text); q.make();
    const n = q.getModuleCount(), s = 8, c = document.createElement("canvas"); c.width = c.height = (n + 2) * s;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + 1) * s, (r + 1) * s, s, s);
    return c.toDataURL("image/jpeg", 0.95);
  }
  const PINK = [232, 120, 150];
  function drawFrame(pdf, exam, st, pg) {
    pdf.setFillColor(0, 0, 0);
    MARK.forEach(([x, y]) => pdf.rect(x - MK / 2, y - MK / 2, MK, MK, "F"));
    const bits = codeBits(exam.id % 64, st.code, pg.page);
    codeCells().forEach(([x, y], i) => { if (bits[i]) pdf.rect(x - CODE_S / 2, y - CODE_S / 2, CODE_S, CODE_S, "F"); });
    pdf.setDrawColor(190, 190, 190); pdf.setLineWidth(0.15);
    codeCells().forEach(([x, y], i) => { if (!bits[i]) pdf.rect(x - CODE_S / 2, y - CODE_S / 2, CODE_S, CODE_S, "S"); });
    const qr = qrImg(`HZM|${exam.id}|${st.code}|${pg.page}`);
    if (qr) pdf.addImage(qr, "JPEG", QR.x, QR.y, QR.s, QR.s);
    putText(pdf, "헤이즐's 동형모의고사 OMR", 20, 21, 9, { color: "#C2185B", w: 800 });
    putText(pdf, exam.title || "동형모의고사", 20, 29, 15, { w: 900, max: 140 });
    putText(pdf, `${exam.cls || ""}  ·  ${exam.day || ""}${pg.kind === "sub" ? "  ·  서술형 답안" : ""}`, 20, 36.5, 9.5, { color: "#555", w: 500, max: 140 });
    pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.5); pdf.roundedRect(20, 40.5, 140, 13, 2, 2, "S");
    putText(pdf, "이름", 25, 47, 9, { color: "#555", w: 500 });
    putText(pdf, st.name ? st.name : "", 40, 47, 17, { w: 900, max: 112 });
    if (!st.name) putText(pdf, "← 이름을 또박또박 쓰세요", 70, 47, 9, { color: "#999", w: 500 });
    putText(pdf, "※ 검은 네모 · 아래 코드 줄 · QR을 가리거나 접지 마세요", 105, 292.5, 7, { color: "#888", w: 500, align: "center" });
  }
  function drawObj(pdf, pg) {
    putText(pdf, "컴퓨터용 사인펜으로 ● 처럼 꽉 채워 칠하세요. 고칠 땐 수정테이프.", 20, 57.5, 8, { color: "#777", w: 500 });
    pg.items.forEach((it, k) => {
      if (k % 5 === 0 && k % pg.rows !== 0 || false) {}
      putText(pdf, it.label, it.lx + 3.2, it.y, Math.min(10, pg.rp * 1.2), { w: 800, align: "right" });
      pdf.setDrawColor(...PINK); pdf.setLineWidth(0.3);
      it.bubbles.forEach(([x, y], b) => {
        pdf.ellipse(x, y, pg.bd / 2 * 0.86, pg.bd / 2, "S");
        putText(pdf, String(b + 1), x, y, Math.min(6.5, pg.bd * 1.5), { color: "rgb(232,120,150)", w: 500, align: "center" });
      });
    });
    pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.2);
    for (let c = 1; c < pg.cols; c++) { const x = 16 + c * pg.cw; pdf.line(x - 1, 60, x - 1, 274); }
  }
  function drawSub(pdf, pg) {
    putText(pdf, "서술형: 상자 안에만 또박또박 쓰세요. 상자 밖 글씨는 채점하지 않아요.", 20, 57.5, 8, { color: "#777", w: 500 });
    pg.boxes.forEach(b => {
      pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.35); pdf.roundedRect(b.x, b.y, b.w, b.h, 1.5, 1.5, "S");
      putText(pdf, `서술형 ${b.label}${b.pts ? ` (${b.pts}점)` : ""}`, b.x + 2.5, b.y + 3.6, 8, { color: "#C2185B", w: 800 });
    });
  }
  async function makePDF(exam, students) {   // students: [{name, code}]
    const { jsPDF } = G.jspdf; const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    try { await document.fonts.load("900 20px 'Noto Sans KR'"); await document.fonts.load("500 20px 'Noto Sans KR'"); } catch (e) {}
    const pages = layout(exam); let first = true;
    for (const st of students) for (const pg of pages) {
      if (!first) pdf.addPage(); first = false;
      drawFrame(pdf, exam, st, pg); pg.kind === "obj" ? drawObj(pdf, pg) : drawSub(pdf, pg);
      await new Promise(r => setTimeout(r, 0));
    }
    return pdf;
  }

  /* ── 이미지 준비 ── */
  function toGray(canvas) {
    const g = canvas.getContext("2d", { willReadFrequently: true }), { width: w, height: h } = canvas;
    const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { w, h, g: out };
  }
  function fitCanvas(src, max) {
    const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
    const k = Math.min(1, max / Math.max(sw, sh)), c = document.createElement("canvas");
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function integral(G1) {
    const { w, h, g } = G1, I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    return I;
  }
  function localMean(I, w, h, x, y, r) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1), W1 = w + 1;
    return (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
  }
  /* 검은 덩어리 찾기 (적응 이진화 + 연결 요소) */
  function blobs(G1, I) {
    const { w, h, g } = G1, r = Math.max(8, Math.round(Math.min(w, h) / 16)), bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const m = localMean(I, w, h, x, y, r); bin[y * w + x] = g[y * w + x] < m * 0.72 && g[y * w + x] < 150 ? 1 : 0; }
    const lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h); let L = 0;
    const minA = Math.pow(Math.min(w, h) * 0.006, 2), maxA = Math.pow(Math.min(w, h) * 0.09, 2);
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      L++; let sp = 0, a = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0; stack[sp++] = i; lab[i] = L;
      while (sp) { const p = stack[--sp], x = p % w, y = (p - x) / w; a++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = L; stack[sp++] = p - 1; }
        if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = L; stack[sp++] = p + 1; }
        if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = L; stack[sp++] = p - w; }
        if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = L; stack[sp++] = p + w; } }
      if (a < minA || a > maxA) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, asp = bw / bh, fill = a / (bw * bh);
      if (asp < 0.55 || asp > 1.8 || fill < 0.6) continue;
      out.push({ x: sx / a, y: sy / a, a, bw, bh, fill });
    }
    return out;
  }
  /* 호모그래피: 양식 mm → 이미지 px */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
    const n = 8;
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]; if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
    const h = b.map((v, i) => v / A[i][i]);
    return (x, y) => { const z = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z]; };
  }
  function sampler(G1) {
    const { w, h, g } = G1;
    return (x, y) => { if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return 255;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * w + x0;
      return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy; };
  }
  /* (x,y) mm 둘레 r mm 원 안 평균 어두움 (주변 종이 밝기 대비 0~1) */
  function darkness(S, Hm, x, y, r, wr) {
    let s = 0, n = 0; const st = r / 4;
    for (let dy = -r; dy <= r + 1e-6; dy += st) for (let dx = -r; dx <= r + 1e-6; dx += st) { if (dx * dx + dy * dy > r * r) continue; const [u, v] = Hm(x + dx, y + dy); s += S(u, v); n++; }
    const W2 = []; wr = wr || r * 2.2;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; const [u, v] = Hm(x + Math.cos(a) * wr, y + Math.sin(a) * wr); W2.push(S(u, v)); }
    W2.sort((a, b) => b - a); const white = Math.max(60, (W2[2] + W2[3] + W2[4]) / 3);
    return Math.max(0, Math.min(1, 1 - (s / n) / white));
  }
  function readCode(S, Hm) {
    return codeCells().map(([x, y]) => darkness(S, Hm, x, y, 1.3, 2.5) > 0.4 ? 1 : 0);
  }
  function quadArea(p) { let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % 4]; a += x1 * y2 - x2 * y1; } return a / 2; }
  function* combos(n, k, s = 0, pre = []) { if (pre.length === k) { yield pre; return; } for (let i = s; i < n; i++) yield* combos(n, k, i + 1, [...pre, i]); }

  /* 모서리 네 개 + 방향 찾기 → { H, info } */
  function locate(G1, I, qrHint) {
    let C = blobs(G1, I).sort((a, b) => b.a - a.a).slice(0, 10);
    const imgA = G1.w * G1.h; let best = null;
    for (const cb of combos(C.length, 4)) {
      const pts = cb.map(i => C[i]); const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
      pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));   // 화면 기준 시계 방향
      const P = pts.map(p => [p.x, p.y]), A = quadArea(P);
      if (A < imgA * 0.08) continue;
      const amin = Math.min(...pts.map(p => p.a)), amax = Math.max(...pts.map(p => p.a));
      if (amax > amin * 4) continue;
      for (let rot = 0; rot < 4; rot++) {
        const dst = [0, 1, 2, 3].map(k => P[(k + rot) % 4]);
        const Hm = homography(MARK, dst); if (!Hm) continue;
        const S = sampler(G1), bits = readCode(S, Hm), info = parseBits(bits);
        if (info && (!best || A > best.A)) best = { A, Hm, info, S, dst };
        else if (!info && qrHint && !best) {   // 코드 줄을 못 읽으면 QR 위치로 방향만 맞춰 봄
          const [qx, qy] = Hm(QR.x + QR.s / 2, QR.y + QR.s / 2);
          if (Math.hypot(qx - qrHint.x, qy - qrHint.y) < Math.sqrt(A) * 0.08) best = { A, Hm, info: { exam6: qrHint.exam % 64, code: qrHint.code, page: qrHint.page, viaQR: true }, S, dst };
        }
      }
    }
    return best;
  }
  function readQR(canvas) {
    if (!G.jsQR) return null;
    const g = canvas.getContext("2d", { willReadFrequently: true }), d = g.getImageData(0, 0, canvas.width, canvas.height);
    const q = G.jsQR(d.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
    if (!q) return null; const m = /^HZM\|(\d+)\|(\d+)\|(\d+)$/.exec(q.data || ""); if (!m) return null;
    const L = q.location, x = (L.topLeftCorner.x + L.bottomRightCorner.x) / 2, y = (L.topLeftCorner.y + L.bottomRightCorner.y) / 2;
    return { exam: +m[1], code: +m[2], page: +m[3], x, y };
  }
  /* 원근 보정해서 양식 그대로 펴기 (px/mm = s), 영역(mm) 지정 가능 */
  function rectify(G1, Hm, s, rect) {
    rect = rect || { x: 0, y: 0, w: W, h: H };
    const cw = Math.round(rect.w * s), ch = Math.round(rect.h * s), c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const g = c.getContext("2d"), im = g.createImageData(cw, ch), d = im.data, S = sampler(G1);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const [u, v] = Hm(rect.x + (x + 0.5) / s, rect.y + (y + 0.5) / s); const val = S(u, v), i = (y * cw + x) * 4; d[i] = d[i + 1] = d[i + 2] = val; d[i + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  }
  /* 한 장 읽기: canvas → { ok, exam6, code, page, marks[], flags[], vals[][], img, subs[] } */
  function readSheet(canvas, examFor) {
    const cv = fitCanvas(canvas, 2000), G1 = toGray(cv), I = integral(G1);
    let loc = locate(G1, I, null);
    if (!loc) { const q = readQR(cv); if (q) loc = locate(G1, I, q); }
    if (!loc) return { ok: false, why: "모서리 네모 4개나 코드 줄을 찾지 못했어요 (종이 전체가 나오게, 밝은 곳에서 다시 찍어 주세요)" };
    const { Hm, info, S } = loc, exam = examFor(info);
    if (!exam) return { ok: false, why: "이 시험의 OMR이 아니에요 (다른 시험지거나 코드 줄이 가려졌어요)", info };
    const pg = layout(exam)[info.page];
    if (!pg) return { ok: false, why: "이 시험에 없는 쪽이에요", info };
    const out = { ok: true, exam6: info.exam6, code: info.code, page: info.page, kind: pg.kind, viaQR: !!info.viaQR };
    if (pg.kind === "obj") {
      const r = pg.bd * 0.33, vals = pg.items.map(it => it.bubbles.map(([x, y]) => darkness(S, Hm, x, y, r, pg.bd * 0.62)));
      Object.assign(out, decide(vals)); out.vals = vals.map(v => v.map(x => +x.toFixed(3)));
      out.ns = pg.items.map(it => it.n);
      out.img = rectify(G1, Hm, 4).toDataURL("image/jpeg", 0.72);
    } else {
      out.subs = pg.boxes.map(b => ({ n: b.n, img: rectify(G1, Hm, 7, { x: b.x, y: b.y, w: b.w, h: b.h }).toDataURL("image/jpeg", 0.75) }));
      out.img = rectify(G1, Hm, 3).toDataURL("image/jpeg", 0.6);
    }
    return out;
  }
  /* 마킹 판정: 시트 안에서 빈칸 수준·칠한 수준을 스스로 잡음 */
  function decide(vals) {
    const all = vals.flat().sort((a, b) => a - b), med = all[Math.floor(all.length / 2)] || 0;
    const tops = vals.map(v => Math.max(...v)).sort((a, b) => a - b), f0 = tops[Math.floor(tops.length * 0.85)] || 0;
    const blank = Math.min(med, 0.25), fill = Math.max(f0, blank + 0.3);
    const T = Math.max(0.28, blank + 0.5 * (fill - blank)), Tf = Math.max(0.16, blank + 0.22 * (fill - blank));
    const marks = [], flags = [];
    vals.forEach(v => {
      const up = v.map((x, i) => [x, i]).filter(([x]) => x >= T).map(([, i]) => i + 1), mx = Math.max(...v), mi = v.indexOf(mx);
      if (up.length === 1) { marks.push(String(up[0])); flags.push(""); }
      else if (up.length > 1) {
        const s = [...v].sort((a, b) => b - a);
        if (s[1] < s[0] * 0.55 && s[1] < T + 0.08) { marks.push(String(mi + 1)); flags.push("check"); }   // 지운 자국 같음 → 진한 것, 확인 표시
        else { marks.push(up.join(",")); flags.push("multi"); }
      }
      else if (mx >= Tf) { marks.push(String(mi + 1)); flags.push("faint"); }
      else { marks.push(""); flags.push("blank"); }
    });
    return { marks, flags, th: { blank: +blank.toFixed(3), fill: +fill.toFixed(3), T: +T.toFixed(3) } };
  }

  /* PDF·사진 파일 → 캔버스 목록 */
  async function filesToCanvases(files, onp) {
    const out = [];
    for (const f of files) {
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const pdfjs = G.pdfjsLib; const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p), v1 = page.getViewport({ scale: 1 }), k = 2000 / Math.max(v1.width, v1.height), v = page.getViewport({ scale: k });
          const c = document.createElement("canvas"); c.width = Math.round(v.width); c.height = Math.round(v.height);
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, viewport: v }).promise; out.push({ c, name: `${f.name} ${p}쪽` }); onp && onp(out.length);
        }
      } else {
        const url = URL.createObjectURL(f); const im = new Image(); im.src = url;
        await im.decode().catch(() => null); if (!im.naturalWidth) { URL.revokeObjectURL(url); continue; }
        out.push({ c: fitCanvas(im, 2400), name: f.name }); URL.revokeObjectURL(url); onp && onp(out.length);
      }
    }
    return out;
  }
  /* 시험지·해설지 PDF → AI용 JPEG (긴 변 1568px) */
  async function pagesForAI(file, onp) {
    const cs = await filesToCanvases([file], onp);
    return cs.map(({ c }) => fitCanvas(c, 1568).toDataURL("image/jpeg", 0.8));
  }

  G.OMR = { W, H, MARK, layout, codeBits, parseBits, makePDF, readSheet, decide, filesToCanvases, pagesForAI, fitCanvas, homography };
})(window);
