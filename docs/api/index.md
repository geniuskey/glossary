# API 개요

모든 엔드포인트는 `/api/v1` 아래에 있다.

스펙 원본은 `apps/web/src/lib/openapi.ts`에 OpenAPI 3.1로 유지되고,
`GET /api/v1/openapi`가 그 객체를 그대로 JSON으로 돌려준다. 인증이 필요 없다.

```bash
curl -s http://localhost:3000/api/v1/openapi > openapi.json
```

`apps/web/tests/openapi.test.ts`가 `app/api/v1/` 밑의 모든 라우트가 스펙에 있고
메서드까지 일치하는지 검사하므로, 문서와 실제 응답이 갈라질 수 없다.

## 엔드포인트 목록

| 메서드 | 경로 | scope | 설명 |
|---|---|---|---|
| GET | `/openapi` | — | 이 스펙 자체 |
| GET | `/health` | — | DB 연결 포함 상태 확인 |
| POST | [`/setup`](/api/auth#최초-설정) | — | 최초 관리자 계정 생성 (사용자 0명일 때만) |
| POST | [`/auth/register`](/api/auth#계정-만들기) | — | 계정 만들기 (누구나, 역할은 editor 고정) |
| POST | [`/auth/login`](/api/auth#로그인) | — | 세션 쿠키 발급 |
| PATCH | [`/account`](/api/auth#내-표시-이름-변경) | 세션 | 내 표시 이름 변경 |
| POST | [`/account/sso-refresh`](/api/auth#sso-정보-다시-가져오기) | 세션 | 내 SSO 이름·이메일·그룹 다시 가져오기 |
| POST | [`/auth/logout`](/api/auth#로그아웃) | 세션 | 세션 폐기 |
| GET | [`/keys`](/api/auth#키-목록) | 세션 | API 키 목록 |
| POST | [`/keys`](/api/auth#키-발급) | 세션 | API 키 발급 |
| DELETE | [`/keys/{id}`](/api/auth#키-폐기) | 세션 | API 키 폐기 |
| GET | [`/sso`](/api/auth#sso-openid-connect) | 세션(admin) | SSO 설정 조회 (시크릿 제외) |
| PUT | [`/sso`](/api/auth#sso-설정) | 세션(admin) | SSO 설정 저장 |
| POST | [`/sso/discover`](/api/auth#sso-설정) | 세션(admin) | issuer의 발견 문서로 엔드포인트 채우기 |
| GET | [`/sso/proxy-check`](/api/auth#oauth2-proxy-헤더-확인) | 세션(admin) | 현재 요청에 실제 도착한 프록시 헤더 진단 |
| GET | [`/admin/ai-config`](/api/ai#ai-연결-설정) | 세션(admin) | 마스킹된 AI 연결 설정 조회 |
| PATCH | [`/admin/ai-config`](/api/ai#ai-연결-설정) | 세션(admin) | AI 연결 설정 저장 |
| POST | [`/admin/ai-config/models`](/api/ai#모델-목록) | 세션(admin) | 공급자가 제공하는 모델 목록 조회 |
| POST | [`/admin/ai-config/test`](/api/ai#연결-시험) | 세션(admin) | 선택 모델로 실제 생성 요청 시험 |
| GET | [`/admin/term-quality`](/api/ai#콘텐츠-완성도) | 세션(admin) | 콘텐츠 완성도 조회 |
| POST | [`/admin/term-quality`](/api/ai#콘텐츠-완성도) | 세션(admin) | 최소 길이 변경 영향 미리보기 |
| PATCH | [`/admin/term-quality`](/api/ai#콘텐츠-완성도) | 세션(admin) | 최소 길이 저장 |
| POST | [`/chat`](/api/ai#용어집-챗봇) | `read` | 용어집에 근거한 AI 질문 |
| GET | [`/terms`](/api/terms#목록-조회) | `read` | 용어 목록·검색 |
| POST | [`/terms`](/api/terms#등록) | `write` | 용어 등록 |
| GET | [`/terms/{idOrSlug}`](/api/terms#상세) | `read` | 용어 상세 |
| PATCH | [`/terms/{idOrSlug}`](/api/terms#수정) | `write` | 용어 수정 (낙관적 잠금) |
| DELETE | [`/terms/{idOrSlug}`](/api/terms#삭제) | admin | 용어 삭제 |
| GET | [`/terms/{idOrSlug}/revisions`](/api/terms#수정-이력) | `read` | 수정 이력 |
| POST | [`/terms/{idOrSlug}/revisions/{number}/revert`](/api/terms#되돌리기) | `write` | 그 리비전으로 되돌리기 (새 리비전이 쌓인다) |
| POST | [`/terms/lookup`](/api/terms#배치-조회-lookup) | `read` | 배치 표기 조회 (AI-Lint 통합 지점) |
| GET | [`/terms/suggest`](/api/terms#자동완성-suggest) | `read` | 검색창 자동완성 후보 (최대 8개) |
| POST | [`/import`](/api/import) | `write` | 엑셀 임포트 (dry-run 기본) |
| POST | [`/attachments`](/api/attachments#업로드) | `write` | 본문 이미지 업로드·WebP 변환 |
| GET | [`/attachments/{sha256}`](/api/attachments#조회) | `read` | 내용 해시로 첨부 이미지 조회 |

브라우저가 오가는 SSO 창구 두 개(`/auth/sso/start`, `/auth/sso/callback`)는 `/api/v1`
바깥에 있다. 화면 이동으로만 답하는 자리라 JSON 에러 봉투를 쓸 수 없기 때문이다 —
실패는 `/login?sso=<코드>`로 돌아온다. [SSO 연결](/guide/sso)에 코드표가 있다.

## 인증

인증은 두 갈래다.

| 주체 | 방식 |
|---|---|
| 사람(웹 UI) | `glossary_session` 쿠키 또는 신뢰하도록 구성한 oauth2-proxy 헤더 |
| 도구(AI-Lint, CI) | `Authorization: Bearer glk_<prefix>_<secret>` |

`Authorization` 헤더가 있으면 API 키 경로를, 없으면 세션 경로를 탄다.
스킴 토큰(`Bearer`)은 RFC 7235대로 대소문자를 구분하지 않지만 **토큰 본문은 구분한다.**

API 키는 해시만 저장한다. 평문 토큰은 발급 응답에서만 볼 수 있고 이후로는 복구할 수 없다.
자세한 것은 [인증](/api/auth)에 있다.

### scope

키마다 `read` / `write` / `validate` 중 하나 이상을 갖는다. 요구 scope가 없으면
403 `forbidden`이다. 세션 사용자는 scope 대신 `role`(`admin` \| `editor`)로 갈린다.
용어 삭제와 `/admin/*`의 홈·AI·사용자 설정처럼 명시된 관리 작업은 `admin` 전용이다.

## 에러 규약

전 엔드포인트가 같은 봉투를 쓴다. **예외 없음.**

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "다른 사람이 이미 수정했습니다.",
    "details": { "currentRevision": 7 }
  }
}
```

`details`는 있을 때만 실린다. `code`는 기계가 분기할 수 있는 안정된 문자열이다.

| code | HTTP | 언제 |
|---|---|---|
| `validation_failed` | 400 | 입력이 스키마에 맞지 않음. `details`에 필드별 사유 |
| `unauthorized` | 401 | 세션도 유효한 키도 없음 |
| `forbidden` | 403 | 인증은 됐으나 scope/role이 모자람 |
| `not_found` | 404 | 대상 없음. 형식이 잘못된 id도 여기로 온다 |
| `term_not_found` | 404 | 용어 대상이 없음 |
| `revision_conflict` | 409 | 낙관적 잠금 충돌. `details.currentRevision` |
| `email_taken` | 409 | 가입하려는 이메일이 이미 있음(대소문자 무시) |
| `payload_too_large` | 413 | 업로드 본문 상한 초과 |
| `rate_limited` | 429 | 챗봇의 사용자·API Key별 분당 요청 제한 초과 |
| `method_not_allowed` | 405 | `Allow` 헤더에 실제 허용 메서드가 실려 온다 |
| `internal_error` | 500 | 처리되지 않은 예외. 스택은 응답에 노출하지 않는다 |
| `ai_provider_error` | 502 | 선택 모델·인증·할당량 또는 AI 공급자 연결 문제 |
| `ai_not_enabled` | 503 | 관리자가 용어 챗봇 연결을 활성화하지 않음 |

::: tip 4xx와 5xx의 경계
재시도해도 절대 성공하지 않는 입력은 5xx가 아니라 4xx다. `?page=1e999`이나 형식이
잘못된 UUID는 그대로 Postgres로 흘러가면 500이 되지만, 기계 클라이언트에게 "나중에
다시 시도하라"는 신호를 주면 안 되므로 라우트가 미리 걸러 400/404로 답한다.
:::

### 405와 Allow 헤더

라우트는 자신이 처리하지 않는 메서드를 명시적으로 405 스텁으로 export한다.
Next의 기본 405는 0바이트 본문에 content-type도 없어 위 규약을 깬다.
`OPTIONS`도 함께 만들어져서 `Allow` 헤더가 실제 허용 메서드와 항상 일치한다
(`GET`을 허용하는 라우트는 `HEAD`도 같이 광고한다).

```
$ curl -i -X PUT http://localhost:3000/api/v1/terms
HTTP/1.1 405 Method Not Allowed
allow: GET, HEAD, POST
{"error":{"code":"method_not_allowed","message":"지원하지 않는 메서드입니다."}}
```

## 상태를 바꾸는 GET은 만들지 않는다

CSRF 방어가 현재 `SameSite=Lax` 쿠키 하나뿐이라, 상태 변경은 반드시 POST/PATCH/DELETE다.
로그아웃이 GET이 아니라 POST인 이유가 이것이다.
`apps/web/tests/screen-guards.test.ts`가 이 규칙을 강제한다.

## HTTPS

온프레미스 기본 구성은 **평문 HTTP**다. 세션 쿠키에 `Secure`가 붙지 않는다 — 평문
HTTP에서 `Secure`를 붙이면 브라우저가 쿠키를 버리기 때문이다. 리버스 프록시로 TLS를
씌운다면 `apps/web/src/app/api/v1/auth/login/route.ts`에서 `Secure`를 직접 추가해야 한다.
자동으로 붙지 않는다. 자세한 것은 [운영 안내서](/operations#네트워크와-인증-—-알고-넘어가야-할-것)에 있다.
