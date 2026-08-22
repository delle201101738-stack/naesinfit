import { neon } from "@neondatabase/serverless";
import { TEACHER_PIN } from "./_config.js";

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
  ready = true;
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

export function checkPin(req) {
  // Vercel 환경변수가 있으면 그것을, 없으면 api/_config.js 의 값을 씁니다.
  const pin = process.env.TEACHER_PIN || TEACHER_PIN;
  if (!pin) return { ok: false, why: "NO_PIN" };
  const got = req.headers["x-pin"] || new URL(req.url, "http://x").searchParams.get("pin");
  return got === pin ? { ok: true } : { ok: false, why: "BAD_PIN" };
}
