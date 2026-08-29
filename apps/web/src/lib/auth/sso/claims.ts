/**
 * R132: IdP가 주는 claim에서 "이 사람이 누구인가"를 뽑아내는 순수 함수들.
 *
 * 회사마다 같은 값을 다른 이름으로 준다 — 표시 이름 하나만 봐도 Okta는 `name`,
 * Entra ID는 `name`과 `preferred_username`, 온프레미스 ADFS는
 * `http://schemas.xmlsoap.org/.../claims/name`처럼 URI를 쓴다. 그래서 claim 이름을
 * 코드에 박지 않고 설정(sso_config)에서 후보 목록으로 받고, 여기서는 그 목록을
 * 순서대로 훑어 처음으로 값이 있는 것을 쓴다.
 *
 * 이 파일에는 fetch도 DB도 없다 — SSO에서 조용히 틀리기 쉬운 부분이 전부 여기라
 * 테스트가 실제 IdP 없이 돌 수 있어야 한다.
 */

export type Claims = Record<string, unknown>;

/** 설정 화면은 "name, displayName" 한 줄로 받는다. 쉼표·줄바꿈 아무거나 허용한다. */
export function parseClaimList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function formatClaimList(paths: readonly string[]): string {
  return paths.join(", ");
}

/**
 * claim 하나를 읽는다. `user.profile.name` 같은 점 경로를 지원하되, **먼저 이름
 * 전체로 정확히 찾는다** — ADFS/Entra의 claim 이름에는 점이 들어 있고
 * (`http://schemas.microsoft.com/identity/claims/displayname`), 점을 무조건
 * 경로 구분자로 보면 그런 이름은 영영 못 찾는다.
 */
export function readClaim(claims: Claims, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(claims, path)) return claims[path];

  let cursor: unknown = claims;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** 문자열 하나로 쓸 수 있는 값만 통과시킨다(숫자 sub를 주는 IdP가 있어 숫자도 받는다). */
function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  // upn을 배열 한 칸으로 주는 IdP가 있다. 첫 칸만 본다.
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = asText(item);
      if (text) return text;
    }
  }
  return null;
}

/** 후보를 순서대로 훑어 처음으로 값이 있는 것을 돌려준다. 순서가 곧 우선순위다. */
export function pickClaim(claims: Claims, paths: readonly string[]): string | null {
  for (const path of paths) {
    const text = asText(readClaim(claims, path));
    if (text) return text;
  }
  return null;
}

/**
 * 그룹은 모양이 특히 제각각이다. 배열(문자열), 배열(객체 — Entra의 그룹 객체나
 * `{ "name": "..." }` 형태), 공백/쉼표로 이은 문자열 하나까지 모두 나온다.
 *
 * 이름 하나만 고르는 pickClaim과 달리 **후보 전부를 합친다** — 기본값이
 * `groups, roles`인데 IdP가 둘 다 보내면 둘 다 권한 판단에 써야 한다.
 */
export function pickGroups(claims: Claims, paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown): void => {
    if (typeof value === "string") {
      // 그룹 하나를 문자열로 주는 IdP와 "a,b,c"로 이어 주는 IdP가 둘 다 있다.
      // 공백은 나누지 않는다 — 그룹 이름에 공백이 흔하다("Sensor Team").
      for (const part of value.split(",")) {
        const name = part.trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      add(obj.name ?? obj.displayName ?? obj.value);
    }
  };

  for (const path of paths) add(readClaim(claims, path));
  return out;
}

/**
 * ID 토큰의 payload를 읽는다. 서명은 검증하지 않는다 — 이 토큰은 IdP의 토큰
 * 엔드포인트에서 TLS로 직접 받은 것이라 중간에 낄 수 있는 사람이 없고,
 * OIDC Core 3.1.3.7도 그 경우 서명 검증을 생략할 수 있다고 본다. 브라우저가
 * 실어 온 토큰(implicit)을 여기에 넣으면 이 전제가 깨진다 — 그래서 이 함수는
 * 토큰 교환 응답에만 쓴다.
 */
export function decodeJwtPayload(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Claims;
  } catch {
    return null;
  }
}

/**
 * 운영자에게 "당신의 IdP는 실제로 이 이름들을 보냈다"를 보여주기 위한 목록.
 * 값은 담지 않는다 — 이름만으로 매핑을 고칠 수 있고, 값까지 저장하면 사번·
 * 전화번호 같은 것이 설정 테이블에 남는다.
 */
export function claimKeys(claims: Claims): string[] {
  return Object.keys(claims).sort();
}

export interface ClaimMapping {
  subjectClaims: readonly string[];
  emailClaims: readonly string[];
  nameClaims: readonly string[];
  groupClaims: readonly string[];
}

export interface SsoIdentity {
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

export type IdentityResult =
  | { ok: true; identity: SsoIdentity }
  | { ok: false; reason: "no_subject" | "no_email" };

/**
 * subject와 email은 없으면 진행할 수 없다. subject는 계정을 다시 찾는 열쇠이고
 * (이름·이메일은 바뀌어도 sub는 안 바뀐다), email은 이 앱의 계정 식별자다.
 * 이름은 없으면 이메일로 대신한다 — 이력에 빈 이름이 남지 않게.
 */
export function resolveIdentity(claims: Claims, mapping: ClaimMapping): IdentityResult {
  const subject = pickClaim(claims, mapping.subjectClaims);
  if (!subject) return { ok: false, reason: "no_subject" };

  const email = pickClaim(claims, mapping.emailClaims);
  if (!email) return { ok: false, reason: "no_email" };

  return {
    ok: true,
    identity: {
      subject,
      email: email.toLowerCase(),
      name: pickClaim(claims, mapping.nameClaims) ?? email,
      groups: pickGroups(claims, mapping.groupClaims),
    },
  };
}

/** AD 그룹 이름은 대소문자가 오갈 수 있어 비교만 소문자로 맞춘다(표시는 원문 그대로). */
function normalizeGroups(groups: readonly string[]): Set<string> {
  return new Set(groups.map((g) => g.trim().toLowerCase()).filter(Boolean));
}

export interface AccessDecision {
  allowed: boolean;
  isAdmin: boolean;
}

/**
 * 허용 그룹이 비어 있으면 로그인할 수 있는 사람 전원을 받는다 — 사내 IdP에
 * 붙은 시점에서 이미 "사내 사람"이라는 뜻이라, 목록을 비운 것은 제한 없음이지
 * 아무도 못 들어옴이 아니다(비었을 때 전원 차단으로 만들면 설정을 켜자마자
 * 운영자 자신도 못 들어온다).
 */
export function decideAccess(input: {
  groups: readonly string[];
  allowedGroups: readonly string[];
  adminGroups: readonly string[];
}): AccessDecision {
  const mine = normalizeGroups(input.groups);
  const allowed = normalizeGroups(input.allowedGroups);
  const admin = normalizeGroups(input.adminGroups);

  const passes = allowed.size === 0 || [...mine].some((g) => allowed.has(g));
  return { allowed: passes, isAdmin: passes && [...mine].some((g) => admin.has(g)) };
}
