// 학생 앱이 시작할 때 읽는 공개 설정 — 비밀번호는 절대 내보내지 않습니다.
import * as CFG from "./_config.js";

export default function handler(req, res) {
  const v = CFG.FIXED_SCOPE;
  const ok = v === "본문" || v === "all" ? v : null;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ fixedScope: ok });
}
