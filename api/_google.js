// 구글 서비스 계정으로 시트 읽기 (Vercel 환경변수 GOOGLE_SA_JSON = 서비스 계정 키 JSON 전체, 또는 그 base64)
// 시트(또는 시트가 든 폴더)를 서비스 계정 이메일에 '뷰어'로 공유해 두면 읽을 수 있음
import { createSign } from "node:crypto";

let CACHE = null;
function saKey() {
  const raw = process.env.GOOGLE_SA_JSON || "";
  if (!raw) return null;
  try { return JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")); }
  catch (e) { throw new Error("GOOGLE_SA_JSON 형식이 올바르지 않아요"); }
}
export function saEmail() { const k = saKey(); return k ? k.client_email : ""; }
const b64u = s => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export async function gToken() {
  if (CACHE && CACHE.exp > Date.now() + 60e3) return CACHE.token;
  const k = saKey(); if (!k) throw new Error("NO_SA");
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(head + "." + claim).sign(k.private_key, "base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${sig}` });
  const j = await r.json(); if (!r.ok) throw new Error("구글 인증 실패: " + (j.error_description || j.error || r.status));
  CACHE = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return CACHE.token;
}
async function gget(url) {
  const r = await fetch(url, { headers: { authorization: "Bearer " + await gToken() } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ("구글 요청 실패 " + r.status));
  return j;
}
// 폴더 안 스프레드시트 목록 (하위 폴더는 보지 않음)
export async function listSheets(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const j = await gget(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return j.files || [];
}
// 탭 값 읽기 — 날짜 칸은 일련번호(숫자)로, 나머지는 입력한 그대로
export async function readTab(sheetId, tab, range = "A1:AZ400") {
  const rg = encodeURIComponent(`'${tab}'!${range}`);
  const j = await gget(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rg}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return j.values || [];
}
