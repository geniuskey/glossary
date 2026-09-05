/**
 * R132: SSO 로그인이 실패하면 사용자는 브라우저로 /login에 돌아온다. 이 화면에
 * 무엇을 보여줄지를 코드 하나로 옮긴다 — 실패 이유 원문(토큰 엔드포인트 응답 등)은
 * 서버 로그에만 남기고, 사용자에게는 다음에 무엇을 하면 되는지만 말한다.
 */
export const SSO_ERROR_CODES = [
  "disabled",
  "state",
  "idp",
  "token",
  "no_subject",
  "no_email",
  "not_allowed",
  "no_account",
  "email_conflict",
  "identity_mismatch",
  "server",
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

const MESSAGES: Record<SsoErrorCode, string> = {
  disabled: "SSO 로그인이 켜져 있지 않습니다. 관리자에게 문의하세요.",
  state: "로그인 절차가 만료되었습니다. 다시 시도하세요.",
  idp: "회사 계정 인증이 취소되었거나 거절되었습니다.",
  token: "IdP와 토큰을 주고받지 못했습니다. 관리자에게 문의하세요.",
  no_subject: "IdP 응답에서 사용자 식별자를 찾지 못했습니다. 관리자에게 claim 설정을 확인해 달라고 하세요.",
  no_email: "IdP 응답에서 이메일을 찾지 못했습니다. 관리자에게 claim 설정을 확인해 달라고 하세요.",
  not_allowed: "이 사전에 접근이 허용된 그룹이 아닙니다.",
  no_account: "아직 계정이 없습니다. 관리자에게 계정 생성을 요청하세요.",
  email_conflict: "같은 이메일을 쓰는 다른 계정이 이미 있습니다. 관리자에게 문의하세요.",
  identity_mismatch: "현재 로그인한 계정과 다른 회사 계정이 확인되어 SSO 정보를 가져오지 않았습니다.",
  server: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
};

function isSsoErrorCode(value: unknown): value is SsoErrorCode {
  return typeof value === "string" && (SSO_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * 모르는 코드는 그대로 화면에 찍지 않는다 — 쿼리스트링은 누구나 만들 수 있어서,
 * 그대로 보여주면 이 로그인 화면이 임의 문구를 띄우는 창구가 된다.
 */
export function ssoErrorMessage(code: unknown): string | null {
  if (isSsoErrorCode(code)) return MESSAGES[code];
  return code === undefined || code === null ? null : MESSAGES.server;
}
