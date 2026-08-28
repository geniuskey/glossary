# 인증

## 두 갈래

| 주체 | 방식 |
|---|---|
| 사람(웹 UI) | `grossary_session` 쿠키 |
| 도구(AI-Lint, CI) | `Authorization: Bearer glk_<prefix>_<secret>` |

요청에 `Authorization` 헤더가 있으면 API 키 경로를, 없으면 세션 경로를 탄다.
스킴 토큰(`Bearer`)은 RFC 7235대로 대소문자를 구분하지 않는다 — `bearer glk_...`도
API 키 경로로 간다. 토큰 본문은 대소문자를 구분한다.

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

## API 키

키는 `glk_<prefix>_<secret>` 형태다. `prefix`는 8자리 hex 고정폭이라 `secret`에
`_`가 들어가도 파싱이 어긋나지 않는다.

저장되는 것은 **해시뿐**이다. 평문 토큰은 발급 응답에서만 볼 수 있고 이후로는 복구할
방법이 없다. 검증은 `timingSafeEqual`로 한다 — 문자열 `!==`는 첫 불일치 바이트에서
조기 반환해 타이밍으로 해시를 조금씩 흘릴 수 있다.

### scope

| scope | 허용 |
|---|---|
| `read` | `GET /terms`, `GET /terms/{idOrSlug}`, `GET .../revisions`, `POST /terms/lookup` |
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
  "http://localhost:3000/api/v1/terms?q=exposure&status=approved"

curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"texts":["AE","이미지센서","AutoExposure"]}' \
  http://localhost:3000/api/v1/terms/lookup
```
