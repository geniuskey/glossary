# 인증

## 두 갈래

| 주체 | 방식 |
|---|---|
| 사람(웹 UI) | `grossary_session` 쿠키 |
| 도구(AI-Lint, CI) | `Authorization: Bearer glk_<prefix>_<secret>` |

요청에 `Authorization` 헤더가 있으면 API 키 경로를, 없으면 세션 경로를 탄다.
스킴 토큰(`Bearer`)은 RFC 7235대로 대소문자를 구분하지 않는다 — `bearer glk_...`도
API 키 경로로 간다. 토큰 본문은 대소문자를 구분한다.

## 최초 설정

사용자가 하나도 없는 상태(새 배포)에서만 열리는 창구다. 첫 관리자 계정을 만든다.

```http
POST /api/v1/setup
Content-Type: application/json

{ "email": "admin@example.com", "name": "Admin", "password": "8자 이상" }
```

성공하면 로그인과 똑같이 `Set-Cookie: grossary_session=...`을 내려준다 — 만든 즉시
로그인 상태가 된다. `name`은 생략하면 이메일이 쓰인다.

```
200  생성 성공 (세션 쿠키 발급)
400  validation_failed (이메일 형식, 비밀번호 8자 미만 등)
403  forbidden — 이미 초기 설정이 끝났다
```

::: warning 먼저 도달한 사람이 관리자다
`/setup`은 **사용자 테이블이 비어 있을 때만** 동작한다. 첫 관리자가 생기면 이후
`POST /api/v1/setup`은 항상 403이고, 웹의 `/setup` 화면은 로그인으로 리다이렉트된다.
동시 요청은 advisory lock으로 직렬화되어 관리자는 한 번만 만들어진다. 다만 설정을
끝내기 전 창구는 열려 있으므로, 배포 직후 바로 첫 관리자를 만들어야 한다.
:::

## 계정 만들기

로그인 화면의 "계정 만들기"가 부르는 창구다. 승인 워크플로우 없이 로그인한 사람이면
누구나 편집하는 위키라, 계정 발급을 관리자가 쥐고 있지 않다.

```http
POST /api/v1/auth/register
Content-Type: application/json

{ "email": "kim@example.com", "name": "김개발", "password": "8자 이상" }
```

성공하면 로그인과 똑같이 `Set-Cookie: grossary_session=...`을 내려준다 — 만든 즉시
로그인 상태가 된다. `name`은 생략하면 이메일이 쓰이고, 이 이름이 수정 이력에 그대로
나간다.

```
200  생성 성공 (세션 쿠키 발급)
400  validation_failed (이메일 형식, 비밀번호 8자 미만)
403  forbidden — 계정이 하나도 없다. /setup으로 첫 관리자를 먼저 만든다
409  email_taken — 이미 가입된 이메일
```

- **역할은 언제나 `editor`다.** 요청에 `role`을 실어도 무시한다. 관리자는 최초
  설정(`/setup`)과 `scripts/seed-admin.ts`로만 생긴다 — 그렇지 않으면 가입 폼에 필드
  하나 추가하는 것으로 누구나 용어 삭제 권한을 갖게 된다.
- **이메일은 대소문자를 구분하지 않는다.** `Kim@Example.com`으로 가입하면
  `kim@example.com`으로 저장되고, 로그인도 두 형태 모두 같은 계정을 찾는다
  (`users_email_lower_unique`가 유일성을 소문자 기준으로 강제한다).
- 로그인과 달리 **계정 존재 여부를 숨기지 않는다**(409). 가입 화면에서 무엇이
  잘못됐는지 말해주지 않으면 사용자는 같은 이메일로 계속 다시 시도한다.

::: warning 가입은 열려 있다
사내망 설치를 전제로 누구나 가입할 수 있다. 레이트 리밋도 이메일 도메인 제한도 아직
없다(M2). 그때까지는 망 접근 통제가 유일한 울타리다.
:::

## 로그인

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "..." }
```

성공하면 `Set-Cookie: grossary_session=...`을 내려준다.

```
200  로그인 성공
400  validation_failed
401  unauthorized
```

::: warning 계정 존재 여부는 새지 않는다
계정이 없는 경우와 비밀번호가 틀린 경우를 응답으로도, 응답 시간으로도 구분하지 않는다.
다만 **레이트 리밋과 계정 잠금은 아직 없다**(M2). 그때까지는 사내망 접근 통제에 의존한다.
:::

쿠키 속성은 `HttpOnly; SameSite=Lax; Path=/`다. `Secure`는 붙지 않는다 — 온프레미스
기본 구성이 평문 HTTP라서 붙이면 브라우저가 쿠키를 버린다. TLS를 씌운다면
`apps/web/src/app/api/v1/auth/login/route.ts`에서 직접 추가한다.

## 로그아웃

```http
POST /api/v1/auth/logout
```

GET이 아니라 POST다. CSRF 방어가 `SameSite=Lax` 쿠키 하나뿐이라 상태를 바꾸는 GET을
만들면 그 방어가 즉시 무너진다.

## SSO (OpenID Connect / OAuth 2.0)

회사 계정으로 로그인하는 경로다. 붙이는 방법과 claim 매핑 설명은
[SSO 연결](/guide/sso)에 있고, 여기서는 창구만 적는다.

브라우저가 오가는 두 자리는 **`/api/v1` 바깥**이다. 화면 이동으로만 답하는 자리라
JSON 에러 봉투를 쓸 수 없다 — 이 저장소의 "모든 에러는 JSON, 예외 없음" 규약을
깨지 않으려고 API 밖에 두었다.

| 경로 | 하는 일 |
|---|---|
| `GET /auth/sso/start` | PKCE·state(및 OIDC nonce)를 만들어 흐름 쿠키에 담고 인증 서버로 302 |
| `GET /auth/sso/callback` | 코드를 토큰으로 바꾸고 OIDC 검증 또는 OAuth userinfo 조회 후 세션 발급 |

둘 다 응답은 302뿐이다. 실패하면 `/login?sso=<코드>`로 돌아온다
(`disabled` `state` `idp` `token` `no_subject` `no_email` `not_allowed` `no_account`
`email_conflict` `server` — 모르는 코드는 일반 문구로 뭉갠다. 쿼리스트링은 누구나
만들 수 있어서, 그대로 보여주면 로그인 화면이 임의 문구를 띄우는 창구가 된다).

### SSO 설정

관리자 세션만 쓸 수 있다. `Authorization` 키로는 부를 수 없다(역할이 없는 자격이라
관리자 판정을 할 수 없다).

```http
GET /api/v1/sso
```

```json
{
  "sso": {
    "enabled": true,
    "protocol": "oidc",
    "buttonLabel": "회사 계정으로 로그인",
    "issuer": "https://login.example.com/realms/company",
    "jwksUri": "https://login.example.com/realms/company/protocol/openid-connect/certs",
    "authorizationEndpoint": "…", "tokenEndpoint": "…", "userinfoEndpoint": "…",
    "clientId": "grossary",
    "hasClientSecret": true,
    "nameClaims": ["name", "displayName", "preferred_username"],
    "groupClaims": ["groups", "roles"],
    "allowedGroups": [], "adminGroups": ["Glossary-Admins"],
    "autoCreate": true,
    "lastClaimKeys": ["email", "groups", "name", "sub"],
    "lastLoginAt": "2026-08-29T02:11:03.000Z"
  },
  "redirectUri": "https://glossary.example.com/auth/sso/callback"
}
```

- `clientSecret`은 **어떤 응답에도 실리지 않는다.** 채워져 있는지만(`hasClientSecret`)
  알려준다.
- `redirectUri`는 IdP에 등록할 주소다. 인가·토큰 요청에 실제로 실리는 값과 **같은
  함수**가 만든다 — 한 글자만 달라도 IdP가 거절한다.
- `lastClaimKeys`는 마지막 SSO 로그인에서 IdP가 보낸 claim **이름**이다. 값은 남기지
  않는다. 매핑이 틀려 실패했을 때도 갱신된다.

```http
PUT /api/v1/sso
Content-Type: application/json

{ "protocol": "oauth2", "userinfoEndpoint": "https://login.example.com/userinfo", "nameClaims": ["displayName", "name"], "clientSecret": "" }
```

부분 갱신이다. 보낸 필드만 바뀐다.

```
200  저장됨 (GET과 같은 형태로 돌려준다)
400  validation_failed — 값 형식이 틀렸거나, 켜는 데 필요한 값이 빠졌다(details.problems)
401  unauthorized
403  forbidden — 관리자만
```

- **`clientSecret: ""`은 "그대로 두기"**, `null`은 "지우기"다. 화면이 저장된 시크릿을
  되받지 못해 언제나 빈 칸으로 열리는데, 그 빈 칸을 반영하면 다른 항목 하나 고칠
  때마다 SSO가 조용히 꺼진다.
- 서버가 채우는 값(`lastClaimKeys`, `lastLoginAt`, `updatedBy`)은 본문으로 받지 않는다.
  보내면 400이다.
- Issuer/JWKS/엔드포인트/외부 주소는 `http(s)`만 받는다. 서버가 이 중 일부 주소로
  직접 요청하기 때문이다.

```http
POST /api/v1/sso/discover
Content-Type: application/json

{ "issuer": "https://login.example.com/realms/company", "protocol": "oidc" }
```

OIDC는 `<issuer>/.well-known/openid-configuration`, OAuth 2.0은
`<issuer>/.well-known/oauth-authorization-server`를 읽어 엔드포인트, JWKS URI와
`claims_supported`를 돌려준다. 저장하지는 않는다.

```
200  { "discovery": { "issuer", "authorizationEndpoint", "tokenEndpoint", "userinfoEndpoint", "jwksUri", "scopesSupported", "claimsSupported" } }
400  validation_failed — 그 주소에서 설정을 읽지 못했다
403  forbidden — 관리자만
```

::: warning 관리자 전용인 이유
서버가 임의의 주소로 요청을 보내는 창구(SSRF)다. 로그인한 편집자 누구나 부를 수 있으면
사내망 스캐너가 된다.
:::

### oauth2-proxy 헤더 확인

```http
GET /api/v1/sso/proxy-check
```

관리자의 현재 요청에 실제 도착한 헤더를 읽어 `authMode`, `trusted`, `detected`, 사용한
헤더명과 복원된 사용자 정보를 반환한다. 저장된 샘플 값을 검사하는 API가 아니다.
`AUTH_MODE=oauth2-proxy`에서는 관리자 자신도 이메일 헤더로 식별되어야 하며, 혼합
OIDC/OAuth2 모드에서는 `SSO_TRUST_PROXY_HEADERS=true`일 때만 인증 헤더로 사용한다.
구성과 보안 전제는 [SSO 연결](/guide/sso)을 따른다.

## API 키

키는 `glk_<prefix>_<secret>` 형태다. `prefix`는 8자리 hex 고정폭이라 `secret`에
`_`가 들어가도 파싱이 어긋나지 않는다.

저장되는 것은 **해시뿐**이다. 평문 토큰은 발급 응답에서만 볼 수 있고 이후로는 복구할
방법이 없다. 검증은 `timingSafeEqual`로 한다 — 문자열 `!==`는 첫 불일치 바이트에서
조기 반환해 타이밍으로 해시를 조금씩 흘릴 수 있다.

### scope

| scope | 허용 |
|---|---|
| `read` | `GET /terms`, `GET /terms/{idOrSlug}`, `GET .../revisions`, `POST /terms/lookup`, `GET /terms/suggest` |
| `write` | `POST /terms`, `PATCH /terms/{idOrSlug}`, `POST /import` |
| `validate` | (M2) `POST /validate`, `POST /validate/batch` |

요구 scope가 없으면 403 `forbidden`이다.

키에는 **역할 개념이 없다.** `DELETE /terms/{idOrSlug}`는 `admin` 역할이 필요하므로
API 키로는 절대 호출할 수 없다.

키가 쓰일 때마다 `last_used_at`이 갱신된다. `revoked_at`이 찍혔거나 `expires_at`이
지난 키는 조회 단계에서 아예 걸러진다.

### 키 목록

세션 로그인 상태여야 한다. 비밀값은 돌려주지 않는다.

```http
GET /api/v1/keys
```

```json
{
  "keys": [
    {
      "id": "…", "name": "ai-lint-ci", "prefix": "3f9a1c07",
      "scopes": ["read", "validate"],
      "createdAt": "2026-08-20T02:11:03.000Z",
      "lastUsedAt": "2026-08-28T01:40:12.000Z",
      "revokedAt": null
    }
  ]
}
```

### 키 발급

```http
POST /api/v1/keys
Content-Type: application/json

{ "name": "ai-lint-ci", "scopes": ["read", "validate"] }
```

```json
{
  "key": { "id": "…", "name": "ai-lint-ci", "prefix": "3f9a1c07", "scopes": ["read", "validate"] },
  "token": "glk_3f9a1c07_…"
}
```

`token`은 **이 응답에서만** 나온다. 화면(`/settings/api-keys`)도 발급 직후 한 번만 보여준다.

### 키 폐기

```http
DELETE /api/v1/keys/{id}
```

`204`로 끝난다. 없는 id면 `404`.

## 사용 예

```bash
KEY="glk_3f9a1c07_…"

curl -s -H "Authorization: Bearer $KEY" \
  "http://localhost:3000/api/v1/terms?q=exposure&status=active"

curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"texts":["AE","이미지센서","AutoExposure"]}' \
  http://localhost:3000/api/v1/terms/lookup
```
