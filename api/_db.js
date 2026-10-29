import { neon } from "@neondatabase/serverless";
import { TEACHER_PIN } from "./_config.js";
import { ROSTER, ROSTER_VERSION } from "./_roster.js";

const URL_ =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!URL_) console.warn("[naesinfit] 데이터베이스 주소(DATABASE_URL)가 설정되지 않았습니다.");

export const sql = URL_ ? neon(URL_) : null;

let ready = false;
export async function ensure() {
  if (!sql) throw new Error("NO_DB");
  if (ready) return;
  await sql`
    create table if not exists attempts (
      id          bigserial primary key,
      student     text        not null,
      book        text        not null default '영어II 천재(강상구) 1과',
      part        text        not null,
      part_name   text        not null,
      scope       text        not null,
      total       int         not null,
      correct     int         not null,
      pct         int         not null,
      secs        int         not null default 0,
      detail      jsonb       not null default '[]'::jsonb,
      created_at  timestamptz not null default now()
    )`;
  await sql`create index if not exists attempts_created_idx on attempts (created_at desc)`;
  await sql`create index if not exists attempts_student_idx on attempts (student)`;
  // 단원 id (예: ce2ne03) — 리포트가 교재 이름 대신 정확한 단원으로 묶도록
  await sql`alter table attempts add column if not exists unit_id text not null default ''`;
  await sql`alter table attempts add column if not exists class_name text not null default ''`;
  // 반 · 숙제 검사 (시험과 별개)
  await sql`create table if not exists hw_classes (
      id bigserial primary key, name text not null, created_at timestamptz not null default now())`;
  await sql`create table if not exists hw_members (
      class_id bigint not null, student text not null, primary key (class_id, student))`;
  await sql`create table if not exists hw_items (
      id bigserial primary key, class_id bigint not null, day text not null,
      title text not null, memo text not null default '', created_at timestamptz not null default now())`;
  await sql`create table if not exists hw_checks (
      item_id bigint not null, student text not null, status text not null,
      score int, memo text not null default '', checked_at timestamptz not null default now(),
      primary key (item_id, student))`;
  // 학부모용: 선생님 코멘트 저장 · 학생별 비공개 링크 · 반 시험(D-day)
  await sql`create table if not exists report_notes (
      student text not null, day text not null, kind text not null default 'day',
      headline text not null default '', note text not null default '', updated_at timestamptz not null default now(),
      primary key (student, day, kind))`;
  await sql`create table if not exists report_tokens (
      token text primary key, student text not null unique, created_at timestamptz not null default now())`;
  await sql`alter table hw_members add column if not exists focus text not null default ''`;   // ★ 집중관리 사유
  await sql`alter table hw_classes add column if not exists exam_date text not null default ''`;
  await sql`alter table hw_classes add column if not exists exam_name text not null default ''`;
  // 학부모 링크 열람 기록 · 비밀번호 틀림 잠금
  await sql`create table if not exists report_views (
      student text not null, day text not null, first_at timestamptz not null default now(),
      last_at timestamptz not null default now(), n int not null default 1, primary key (student, day))`;
  await sql`create table if not exists pin_fails (
      ip text primary key, n int not null default 0, until timestamptz, updated_at timestamptz not null default now())`;
  // 학원 명단(학교+학년 = 반) 한 번만 넣기 — 버전이 바뀌면 다시 맞춤 (있는 학생·반은 그대로 둠)
  await sql`create table if not exists hw_meta (k text primary key, v text not null)`;
  const [mv] = await sql`select v from hw_meta where k = 'roster'`;
  if (!mv || mv.v !== ROSTER_VERSION) {
    for (const [cname, names] of Object.entries(ROSTER)) {
      let [c] = await sql`select id from hw_classes where name = ${cname} order by id limit 1`;
      if (!c) [c] = await sql`insert into hw_classes (name) values (${cname}) returning id`;
      for (const n of names) await sql`insert into hw_members (class_id, student) values (${c.id}, ${n}) on conflict do nothing`;
    }
    await sql`insert into hw_meta (k, v) values ('roster', ${ROSTER_VERSION}) on conflict (k) do update set v = excluded.v`;
  }
  // 예전에 구분자 없이 쓴 이름(김강민)의 시험 기록 → 명단 이름(김강민j)으로 한 번 옮김 (명단 전체에서 그 이름이 하나뿐일 때만)
  const [am] = await sql`select v from hw_meta where k = 'alias'`;
  if (!am || am.v !== ROSTER_VERSION) {
    await sql`with m as (select distinct student, regexp_replace(student, '[A-Za-z0-9]+$', '') as b from hw_members),
                   u as (select b, min(student) as s from m group by b having count(*) = 1)
              update attempts a set student = u.s from u where a.student = u.b and u.b <> u.s and u.b <> ''`;
    await sql`insert into hw_meta (k, v) values ('alias', ${ROSTER_VERSION}) on conflict (k) do update set v = excluded.v`;
  }
  ready = true;
}

// 학부모 링크용 비공개 토큰 (추측 불가 10자)
export async function tokenFor(students) {
  const out = {};
  const have = await sql`select token, student from report_tokens where student = any(${students})`;
  have.forEach(r => { out[r.student] = r.token; });
  const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (const s of students) {
    if (out[s]) continue;
    const { randomBytes } = await import("node:crypto");
    const t = [...randomBytes(10)].map(b => A[b % A.length]).join("");
    await sql`insert into report_tokens (token, student) values (${t}, ${s}) on conflict (student) do nothing`;
    const [r] = await sql`select token from report_tokens where student = ${s}`;
    out[s] = r.token;
  }
  return out;
}

// 이름 칸에 학교·학년을 같이 쓴 경우(김지연_경인1, 경인고 1_ 김지연, 이서준(경인1)) → 명단 이름 찾기
// 명단 이름(구분 글자 뺀 한글)이 앞뒤에 다른 한글 없이 들어 있을 때만, 딱 한 명일 때만 인정 (이준 ⊄ 이준희)
export function nameFromText(text, members, hintClass) {
  const str = String(text || "").replace(/학년/g, " ");
  const H = /[가-힣]/;
  const base = s => s.replace(/[A-Za-z0-9]+$/, "");
  const has = b => { let i = str.indexOf(b); while (i >= 0) { if (!H.test(str[i - 1] || "") && !H.test(str[i + b.length] || "")) return true; i = str.indexOf(b, i + 1); } return false; };
  let cand = members.filter(m => { const b = base(m.student || m); return b.length >= 2 && has(b); });
  const uniq = [...new Set(cand.map(m => m.student || m))];
  if (uniq.length <= 1) return uniq[0] || null;
  if (hintClass) { const h = [...new Set(cand.filter(m => m.class_name === hintClass).map(m => m.student))]; if (h.length === 1) return h[0]; }
  const hinted = [...new Set(cand.filter(m => m.class_name && str.includes(m.class_name.replace(/[0-9]/g, "").replace(/고$/, ""))).map(m => m.student))];
  return hinted.length === 1 ? hinted[0] : null;
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 4e6) reject(new Error("TOO_BIG")); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// 선생님 비밀번호 확인 — 같은 곳에서 8번 틀리면 15분 잠금
const ipOf = req => String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "?").split(",")[0].trim().slice(0, 60);
export async function checkPin(req) {
  // Vercel 환경변수 TEACHER_PIN 이 있으면 그것을, 없으면 api/_config.js 의 값을 씁니다.
  const pin = process.env.TEACHER_PIN || TEACHER_PIN;
  if (!pin) return { ok: false, why: "NO_PIN" };
  const got = String(req.headers["x-pin"] || new URL(req.url, "http://x").searchParams.get("pin") || "");
  if (!got) return { ok: false, why: "BAD_PIN" };
  await ensure();
  const ip = ipOf(req);
  const [f] = await sql`select n, until from pin_fails where ip = ${ip}`;
  if (f && f.until && new Date(f.until) > new Date()) {
    const min = Math.ceil((new Date(f.until) - new Date()) / 60000);
    return { ok: false, why: "LOCKED", min };
  }
  if (got === pin) { if (f) await sql`delete from pin_fails where ip = ${ip}`; return { ok: true }; }
  const n = f && (!f.until || new Date(f.until) <= new Date()) && f.n < 8 ? f.n + 1 : 1;
  const until = n >= 8 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
  await sql`insert into pin_fails (ip, n, until, updated_at) values (${ip}, ${n}, ${until}, now())
            on conflict (ip) do update set n = excluded.n, until = excluded.until, updated_at = now()`;
  return { ok: false, why: until ? "LOCKED" : "BAD_PIN", min: until ? 15 : 0, left: 8 - n };
}
export function pinError(g) {
  if (g.why === "NO_PIN") return "선생님 비밀번호가 아직 설정되지 않았습니다";
  if (g.why === "LOCKED") return `비밀번호를 여러 번 틀려서 잠겼어요. ${g.min || 15}분 뒤에 다시 해 주세요`;
  return g.left != null && g.left <= 3 ? `비밀번호가 맞지 않습니다 (${g.left}번 더 틀리면 15분 잠겨요)` : "비밀번호가 맞지 않습니다";
}
