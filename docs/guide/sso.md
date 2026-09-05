# SSO 연결

회사 계정으로 로그인하게 만드는 설정이다. 관리자로 로그인해
**관리자 패널 → 로그인 · SSO**(`/admin?tab=sso`)에서 현재 적용 방식을 확인한다. OIDC/OAuth 2.0 연결과
oauth2-proxy를 포함한 실제 로그인 방식과 공통 접근 정책은 화면에서 저장한다. `.env`는
oauth2-proxy가 검증한 헤더를 안전하게 받을 수 있는 배포인지와 헤더 이름만 정한다.

화면에는 **SSO 사용하지 않음**, **OpenID Connect(OIDC)**,
**OAuth 2.0 + 사용자 정보 API**, **oauth2-proxy** 네 상태가 표시된다. oauth2-proxy로
바꾸려면 먼저 배포 환경에서 proxy capability를 허용해야 하지만, 활성 방식 선택 자체는
다른 세 방식과 똑같이 화면에서 한다.

**SSO 사용하지 않음**은 비밀번호 로그인이 켜진 배포에서만 선택할 수 있다. SSO 전용
배포에서 이 옵션으로 저장해 모든 로그인 경로를 닫는 실수를 화면과 API가 함께 막는다.

OIDC와 OAuth 2.0은 모두 인가 코드 흐름 + PKCE(S256)를 사용하며 SAML은 지원하지 않는다.

- **OIDC(권장)**: `id_token`의 JWKS 서명, Issuer, Audience, 만료와 Nonce를 검증한다.
- **OAuth 2.0**: Access Token으로 설정한 사용자 정보 API를 호출해 계정 claim을 얻는다.
  일반 OAuth 2.0만으로는 사용자 신원을 정의하지 않으므로 사용자 정보 엔드포인트가 필수다.

## oauth2-proxy 헤더 방식

Glossary 앞의 oauth2-proxy와 nginx가 인증을 끝내고 사용자 헤더를 넘기는 배포도 지원한다.
이 방식은 Glossary가 IdP의 인가·토큰 엔드포인트를 직접 호출하지 않는다.

새 설치에서는 `INITIAL_ADMIN_EMAIL`에 최초 관리자의 회사 이메일을 지정한다. 해당 사용자가
처음 SSO로 들어올 때만 빈 사용자 DB를 열고 관리자 계정을 만든다. 다른 사용자가 먼저
접속해도 최초 설정이 닫히지 않으며, 지정 계정으로 다시 로그인하라는 안내를 표시한다.

```dotenv
OAUTH2_PROXY_ENABLED=true
INITIAL_ADMIN_EMAIL=admin@example.com
PASSWORD_LOGIN_ENABLED=false
# oauth2-proxy 기본 prefix를 바꿨을 때만 지정
SSO_LOGIN_URL=
OAUTH2_PROXY_PREFERRED_USERNAME_HEADER=X-Forwarded-Preferred-Username
OAUTH2_PROXY_EMAIL_HEADER=X-Forwarded-Email
OAUTH2_PROXY_GROUPS_HEADER=X-Forwarded-Groups
OAUTH2_SUBJECT_FIELD=email
```

최초 부팅에서 `PASSWORD_LOGIN_ENABLED=false`이면 로그인 API와 가입·비밀번호 최초 설정
화면이 닫힌다. 첫 관리자가 SSO로 들어온 뒤에는 **관리자 패널 → 로그인 · SSO → ID/비밀번호 로그인**에서
허용 여부를 저장하며, DB 값이 환경변수보다 우선한다.
로그인하지 않은 사용자가 홈이나 로그인 화면에 접속하면 곧바로 SSO로 이동한다. 기본
진입점은 `/oauth2/start?rd=%2F`이며 프록시 경로가 다르면 `SSO_LOGIN_URL`에 완성된 내부
경로 또는 HTTPS URL을 지정한다.

| 값 | 사용법 |
|---|---|
| `X-Forwarded-Preferred-Username` | 화면에 표시할 닉네임. percent-encoded 값과 UTF-8을 latin-1/Windows-1252로 잘못 읽은 한글도 복원한다 |
| `X-Forwarded-Email` | 사용자 이메일이자 기본 계정 식별자. 소문자로 맞춰 저장한다 |
| `X-Forwarded-Groups` | 쉼표로 구분한 그룹. 전체는 권한 판단에 쓰고 **첫 번째 항목은 표시 조직**으로 쓴다 |

`OAUTH2_PROXY_ENABLED=true`는 로그인 방식을 강제로 바꾸지 않는다. nginx와 네트워크가
검증된 헤더를 전달할 수 있다는 **capability**만 연다. 앱을 다시 시작한 뒤 **관리자 패널 → 로그인 · SSO**에서
**oauth2-proxy**를 선택해 저장해야 활성화된다. 반대로 OIDC나 OAuth 2.0이 선택돼 있으면
capability가 켜져 있어도 proxy 헤더로 인증하지 않는다.

oauth2-proxy가 활성인데 헤더가 없거나 capability가 꺼져 있으면 로컬 세션으로 우회하지
않는다. 앱 포트 직접 접속이 proxy를 건너뛰는 로그인 경로가 되지 않도록 실패로 닫는다.

이전 버전의 `AUTH_MODE=oauth2-proxy`와 `SSO_TRUST_PROXY_HEADERS`는 업그레이드 중 인증이
끊기지 않도록 당분간 읽는다. 새 설정에서는 `OAUTH2_PROXY_ENABLED`로 옮기고 기존 두 변수는
제거한다. 마이그레이션 직후 DB에 명시 모드가 없으면 기존 proxy 설정을 최초 모드로 한 번
추론하며, 새 빈 설치에서는 최초 관리자 로그인에만 capability를 초기 proxy 모드로 쓴다.
최초 로그인이 성공하면 이를 DB에 저장하고, 그 뒤에는 DB 모드가 항상 우선한다.

기존 배포의 헤더명 환경변수도 그대로 받는다.

- 닉네임: `OAUTH2_PROXY_PREFERRED_USERNAME_HEADER`, `OAUTH2_PROXY_USER_HEADER`,
  `OAUTH2_PROXY_NAME_HEADER`
- 이메일: `OAUTH2_PROXY_EMAIL_HEADER`
- 그룹: `OAUTH2_PROXY_GROUPS_HEADER`
- 새 이름인 `SSO_PROXY_PREFERRED_USERNAME_HEADER`, `SSO_PROXY_EMAIL_HEADER`,
  `SSO_PROXY_GROUPS_HEADER`도 사용할 수 있으며 둘 다 있으면 새 이름이 우선한다.

### nginx auth_request 예시

oauth2-proxy에는 `--reverse-proxy=true --set-xauthrequest=true`가 필요하다.
oauth2-proxy가 응답한 `X-Auth-Request-*`를 nginx 변수로 받은 다음 Glossary가 읽는
`X-Forwarded-*`로 **항상 다시 설정**한다. 플래그와 nginx 연동의 원래 규약은
[oauth2-proxy 공식 nginx 문서](https://oauth2-proxy.github.io/oauth2-proxy/7.11.x/configuration/integration/)에서도
확인할 수 있다.

```nginx
location = /oauth2/auth {
    proxy_pass http://oauth2-proxy:4180;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URL $scheme://$host$request_uri;
}

location @oauth2_signin {
    return 302 /oauth2/sign_in?rd=$scheme://$host$request_uri;
}

location / {
    auth_request /oauth2/auth;
    error_page 401 = @oauth2_signin;

    auth_request_set $auth_name   $upstream_http_x_auth_request_preferred_username;
    auth_request_set $auth_email  $upstream_http_x_auth_request_email;
    auth_request_set $auth_groups $upstream_http_x_auth_request_groups;

    # 클라이언트가 같은 이름으로 보낸 값을 전달하지 않고 인증 결과로 덮어쓴다.
    proxy_set_header X-Forwarded-Preferred-Username $auth_name;
    proxy_set_header X-Forwarded-Email              $auth_email;
    proxy_set_header X-Forwarded-Groups             $auth_groups;
    proxy_set_header X-Forwarded-Host                $host;
    proxy_set_header X-Forwarded-Proto               $scheme;

    proxy_pass http://glossary:3000;
}
```

::: danger 앱 직접 접속을 막아야 한다
이 모드는 nginx가 넣은 헤더와 클라이언트가 위조한 헤더를 앱 자체에서 구분할 수 없다.
Glossary의 3000 포트는 nginx만 접근할 수 있는 내부 네트워크에 두고, 방화벽·포트 바인딩으로
외부 직접 접속을 막아야 한다. nginx도 위 예시처럼 인증 헤더를 전달이 아니라 덮어써야 한다.
:::

### 계정 중복을 막는 식별자 설정

헤더 경로의 기본 사용자 식별자는 이메일이다. OAuth2 인가 코드 흐름도 함께 쓰면
`OAUTH2_SUBJECT_FIELD=email`을 설정한다. 그러면 OAuth2 userinfo의 `email`을 `sub`보다
먼저 계정 식별자로 사용해 두 경로가 같은 `external_id`에 수렴한다. OIDC 코드 흐름과
함께 쓸 때는 **관리자 패널 → 로그인 · SSO → 사용자 식별자(sub)**의 첫 후보를 `email`로 바꿔야 한다.
기존 계정이 이미 다른 `sub`에 연결돼 있으면 앱은 자동으로 덮어쓰지 않고
`email_conflict`로 막는다.

관리자 화면의 **연결 확인**은 관리자의 현재 요청에 도착한 실제 헤더를 검사한다.
성공하면 `프록시 헤더 확인됨 · 김의윤 (보안팀)`처럼 닉네임과 첫 그룹을 보여준다.
이 검사는 IdP에 직접 요청하지 않으므로 인가 서버 연결이 실패하는 상황에서도 헤더
경로가 정상인지 따로 확인할 수 있다.

SSO 표시 이름은 계정을 만들 때 가져오며 이후에는 사용자가 **설정 → 내 계정**에서 직접
바꿀 수 있다. 과거에 mojibake 형태로 저장된 이름은 정상 SSO 이름이 들어오는 다음 로그인에
한 번 자동 복구되며, 사용자가 직접 고친 이름은 이후 SSO 로그인에서 덮어쓰지 않는다.
이름·이메일·그룹을 IdP 값으로 다시 맞추려면 **SSO 정보 다시 가져오기**를 누른다. 이때는
사용자가 명시적으로 요청한 것이므로 직접 고친 표시 이름도 SSO 값으로 덮어쓴다.

oauth2-proxy 세션은 Glossary 밖에서 유지된다. 앱의 **로그아웃**은 로컬 쿠키만 지우므로
전용 모드에서는 다음 요청에 곧바로 다시 인증될 수 있다. 완전한 로그아웃은
oauth2-proxy 또는 IdP의 로그아웃 URL에서 처리한다.

## 1. IdP에 앱 등록

IdP 쪽에서 웹 애플리케이션(Confidential Client) 하나를 만들고, 리디렉션 URI로
설정 화면 맨 위에 표시된 주소를 그대로 등록한다.

```
https://<이 사전의 주소>/auth/sso/callback
```

::: warning 한 글자도 달라선 안 된다
`redirect_uri`는 인가 요청과 토큰 요청에서 완전히 같아야 하고 IdP가 그것을 대조한다.
프록시 뒤라 화면에 뜬 주소가 내부 주소(`http://localhost:3000/...`)로 보인다면,
**외부 주소** 칸에 실제 접속 주소를 적어 못 박는다. 그 값이 비어 있으면
`X-Forwarded-Host` / `X-Forwarded-Proto`를, 그것도 없으면 `Host`를 쓴다.
:::

## 2. 로그인 방식과 엔드포인트 채우기

직접 연결이라면 **OpenID Connect(OIDC)** 또는 **OAuth 2.0**을 고른다. 인증 서버 주소를 적고
**메타데이터 불러오기**를 누르면 방식에 맞는 발견 문서를 읽어 설정을 채운다.

oauth2-proxy를 선택하면 직접 연결 폼 대신 실제 헤더 이름, capability 상태와 연결 확인
결과를 보여준다. 저장할 때 활성 모드와 허용 그룹·관리자 그룹·자동 계정 생성 정책을
반영하며, 사용하지 않는 직접 연결 설정은 보존한다. capability가 꺼져 있으면 카드가
비활성화되고 필요한 환경변수를 안내한다.

| 방식 | 발견 문서 | 필수 값 |
|---|---|---|
| OIDC | `<issuer>/.well-known/openid-configuration` | Issuer, JWKS URI, 인가·토큰 엔드포인트 |
| OAuth 2.0 | `<server>/.well-known/oauth-authorization-server` | 인가·토큰·사용자 정보 엔드포인트 |

발견 문서가 `claims_supported`를 제공하면 다음 단계에서 쓸 claim 이름도 함께 보여준다.
OAuth 메타데이터에는 사용자 정보 엔드포인트가 없는 경우가 많으므로 그 칸은 직접 입력할
수 있다.

발견 문서를 제공하지 않는 서버라면 각 칸을 손으로 채운다. 클라이언트 ID와 시크릿,
토큰 요청 인증 방식(`client_secret_post` / `client_secret_basic`)은 IdP가 알려준 대로 고른다.

::: tip OIDC의 userinfo는 비워도 되지만
그룹을 ID 토큰에 넣지 않고 userinfo에서만 주는 IdP가 많다. 그룹으로 접근·관리자
권한을 가를 생각이면 채워 두는 편이 안전하다.
:::

## 3. 값 매핑 — 이 화면의 핵심

회사마다 같은 값을 다른 이름으로 준다. 표시 이름 하나만 봐도:

| IdP | 이름이 오는 claim |
|---|---|
| Keycloak | `name`, `preferred_username` |
| Entra ID (Azure AD) | `name`, `preferred_username` |
| Okta | `name` |
| 온프레미스 ADFS | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name` |
| 자체 구축 | `displayName`, `username`, `user.profile.name` … |

그래서 claim 이름을 코드에 박지 않고 **후보 목록**으로 받는다. 쉼표로 여러 개 적으면
앞에서부터 **값이 있는 첫 후보**를 쓴다.

```
이름   name, displayName, preferred_username, given_name
그룹   groups, roles
```

- **점 경로**(`user.profile.name`)로 중첩된 값을 꺼낼 수 있다.
- 이름 전체를 먼저 정확히 찾으므로 **점이 들어간 claim 이름**(ADFS/Entra의 URI 형태)도
  그대로 적으면 된다.
- 그룹만 예외적으로 **후보 전부를 합친다.** `groups`와 `roles` 둘 다 오면 둘 다 권한
  판단에 쓰고 담당자 이름 뒤의 group/조직 표시에도 쓴다. 배열, 객체 배열
  (`{ "name": ... }`), `"a,b,c"` 문자열을 모두 읽는다.
- 사용자 식별자(`sub`)는 **계정을 다시 찾는 열쇠**다. 이메일이 바뀌어도 같은 계정으로
  이어지는 근거이므로, 바뀌지 않는 값을 골라야 한다.

### IdP가 실제로 무엇을 보냈는지 보기

매핑을 맞히는 대신 확인할 수 있다. 한 번 로그인해 보면 설정 화면 아래에
**마지막 로그인에서 IdP가 보낸 claim 이름**이 그대로 나온다. 매핑이 틀려
`?sso=no_email`로 튕긴 경우에도 남는다 — 틀렸을 때가 이 목록이 가장 필요한 순간이라서다.

진단 목록에는 값을 남기지 않는다(이름만). 다만 위에서 매핑한 그룹 값은 사용자별
group/조직 표시와 권한 판단을 위해 해당 사용자 계정에 저장하고 로그인할 때 갱신한다.
그 밖의 사번·전화번호 같은 claim 값은 저장하지 않는다.

## 4. 접근과 권한

| 칸 | 뜻 |
|---|---|
| 허용 그룹 | 비우면 **IdP로 로그인되는 사람 전원**. 적으면 그중 하나에 속해야 들어온다 |
| 관리자 그룹 | 여기에 속하면 `admin`으로 **올린다** |
| 자동 생성 | 처음 보는 사람의 계정을 만든다. 끄면 미리 있는 계정만 로그인된다 |

그룹 비교는 대소문자를 가리지 않는다.

::: warning 역할은 올라가기만 한다
그룹 claim이 한 번 비어서 오는 것만으로 관리자가 편집자로 떨어지면, 그 순간 아무도
계정을 되돌릴 수 없다(관리자 전용 화면에서 잠긴다). 그래서 SSO 로그인은 역할을
내리지 않는다. 강등은 DB에서 직접 한다.
:::

## 5. 켜기

로그인 방식에서 **OpenID Connect** 또는 **OAuth 2.0**을 선택하고 저장한다. 공통으로 인가·토큰 엔드포인트,
클라이언트 ID·시크릿과 `sub`/이메일 claim 후보가 필요하다. OIDC는 Issuer·JWKS URI,
OAuth 2.0은 사용자 정보 엔드포인트도 필수다. 빠진 값이 있으면 저장이 거절되고 무엇이
필요한지 알려준다 — 빈 설정으로 켜면 버튼을 누른 사용자가 대신 실패를 보게 된다.

시크릿 칸은 저장 후 언제나 비어 보인다(저장된 값을 되돌려주지 않는다). **빈 칸은
"그대로 두기"**이므로 버튼 문구만 고쳐도 시크릿이 지워지지 않는다.

## 계정이 이어지는 방식

1. `sub`로 찾는다 — 이름·이메일이 바뀌어도 같은 계정이다.
2. 없으면 같은 이메일의 계정에 `sub`를 붙인다(SSO를 켜기 전 비밀번호로 쓰던 계정을
   한 번 이어 붙이는 경로). 비밀번호는 지우지 않는다.
3. 그 이메일이 **이미 다른 `sub`에 묶여 있으면 거절한다**(`email_conflict`). 덮어쓰면
   IdP에서 계정을 지웠다 다시 만든 사람이 남의 이력을 이어받는다.
4. 그래도 없으면 자동 생성 설정에 따라 새로 만든다. 이때 비밀번호는 저장하지 않으므로
   그 계정은 SSO로만 들어온다.

## 문제 해결

로그인이 실패하면 `/login?sso=<코드>`로 돌아온다.

| 코드 | 화면 문구가 뜻하는 것 | 볼 곳 |
|---|---|---|
| `disabled` | SSO가 꺼져 있다 | 설정 화면의 체크박스 |
| `state` | 10분이 지났거나 다른 브라우저·탭에서 시작했다. `nonce` 불일치도 여기로 온다 | 다시 시도 |
| `idp` | IdP가 거절·취소를 알려 왔다 | 서버 로그의 `authorization_response` |
| `token` | 토큰 교환·ID 토큰 검증·userinfo 요청이 실패했다 | 서버 로그의 `token_exchange`, `oidc_verification`, `userinfo_request` |
| `no_subject` / `no_email` | 매핑이 틀렸다 | 설정 화면의 **IdP가 보낸 claim 이름** |
| `not_allowed` | 허용 그룹에 없다 | 그룹 claim 후보와 허용 그룹 |
| `no_account` | 계정이 없고 자동 생성이 꺼져 있다 | 자동 생성 |
| `email_conflict` | 같은 이메일이 다른 `sub`에 묶여 있다 | `users` 테이블 |
| `server` | 그 외 | 서버 로그 |

오류 상세는 앱 컨테이너의 표준 오류 출력에 `[Glossary SSO]`로 시작하는 한 줄 JSON으로
남는다. 로그인 화면에는 다음에 무엇을 하면 되는지만 나온다.

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

`stage`로 실패 지점을 찾고 `detail`, `providerError`, `providerDescription`, `error`를 본다.
로그에는 시간·방식·엔드포인트·JWT 검증 예외·IdP 오류 설명이 포함되지만 `id_token`,
`access_token`, 인가 코드, state/nonce/PKCE verifier, 클라이언트 시크릿은 값 대신
`[redacted]`로 기록한다.

| stage | 먼저 확인할 것 |
|---|---|
| `authorization_response` | IdP 정책, 등록된 리디렉션 URI, 사용자 동의 |
| `flow_validation` | 콜백 쿠키, state, 10분 제한, 설정 방식 변경 여부 |
| `token_exchange` | 클라이언트 시크릿, 인증 방식, 토큰 엔드포인트, `redirect_uri` |
| `oidc_verification` | JWKS URI, 서명 키 `kid`, Issuer, Audience(client ID), 만료, nonce |
| `userinfo_request` | 사용자 정보 URL, Access Token 권한(scope), JSON 응답 여부 |
| `identity_mapping` | 설정 화면의 실제 claim 이름과 sub/이메일 매핑 |

## 보안 메모

- OIDC ID 토큰은 발견 문서 또는 설정에 저장한 JWKS URI의 공개 키로 서명을 검증한다.
  Issuer, Audience(client ID), 만료와 nonce 검증을 모두 통과한 payload만 사용한다.
  브라우저가 직접 실어 오는 토큰(implicit)은 받지 않는다.
- userinfo는 `sub`가 ID 토큰과 같을 때만 합친다(OIDC Core 5.3.2). 다르면 통째로 버린다 —
  그러지 않으면 access token만 바꿔치기해 남의 이름과 그룹을 얹을 수 있다.
- `state` / `nonce` / PKCE 검증자는 10분짜리 HttpOnly 쿠키(`Path=/auth/sso`)에 담기고
  성공·실패와 관계없이 지워진다. 남겨 두면 같은 `state`로 콜백을 다시 먹일 수 있다.
- 클라이언트 시크릿은 어떤 응답에도 실리지 않는다. 화면은 "채워져 있는가"만 받는다.
- 발견(`POST /api/v1/sso/discover`)은 서버가 임의 주소로 요청을 보내는 창구라 관리자
  전용이다.
