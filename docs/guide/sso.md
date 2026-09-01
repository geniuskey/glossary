# SSO 연결

회사 계정으로 로그인하게 만드는 설정이다. 관리자로 로그인해
**설정 → SSO**(`/settings/sso`)에서 채운다. 환경변수가 아니라 화면에서 고치는 값이다 —
사내 IdP를 붙이는 사람과 컨테이너를 띄우는 사람이 다르고, claim 이름은 몇 번 고쳐 봐야
맞는 값을 찾는 종류라 재배포 없이 바꿀 수 있어야 한다.

로그인 방식은 **OpenID Connect(OIDC)**와 **OAuth 2.0 + 사용자 정보 API** 중에서
고를 수 있다. 둘 다 인가 코드 흐름 + PKCE(S256)를 사용하며 SAML은 지원하지 않는다.

- **OIDC(권장)**: `id_token`의 JWKS 서명, Issuer, Audience, 만료와 Nonce를 검증한다.
- **OAuth 2.0**: Access Token으로 설정한 사용자 정보 API를 호출해 계정 claim을 얻는다.
  일반 OAuth 2.0만으로는 사용자 신원을 정의하지 않으므로 사용자 정보 엔드포인트가 필수다.

<img src="/images/sso-login-method.png" width="1440" height="960" loading="lazy" alt="SSO 설정에서 OpenID Connect와 OAuth 2.0 로그인 방식을 선택하는 화면">

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

먼저 **OpenID Connect(OIDC)** 또는 **OAuth 2.0**을 고른다. 인증 서버 주소를 적고
**메타데이터 불러오기**를 누르면 방식에 맞는 발견 문서를 읽어 설정을 채운다.

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

**로그인 화면에 SSO 버튼 보이기**를 켜고 저장한다. 공통으로 인가·토큰 엔드포인트,
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

오류 상세는 앱 컨테이너의 표준 오류 출력에 `[Grossary SSO]`로 시작하는 한 줄 JSON으로
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
