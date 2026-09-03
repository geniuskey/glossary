# 시작하기

로컬 개발 환경을 세우는 절차다. 운영 배포는 [운영 안내서](/operations)를 본다.

## 요구사항

- Node.js **22 이상**
- pnpm **9.12.0** (`packageManager` 필드로 고정되어 있다)
- Docker (Postgres 16 컨테이너용)

```bash
corepack enable
```

## 1. 의존성 설치

```bash
pnpm install
```

## 2. 환경 변수

```bash
cp .env.example .env
```

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | 앱이 붙는 개발 DB |
| `DATABASE_URL_TEST` | `packages/db` 통합 테스트 전용 DB |
| `POSTGRES_PASSWORD` | 프로덕션 Compose에서만 쓴다 |
| `AUTH_MODE` | 기본 `local`; oauth2-proxy 헤더 인증은 `oauth2-proxy` |
| `SSO_TRUST_PROXY_HEADERS` | OIDC/OAuth2 혼합 모드의 헤더 신뢰 여부. 기본 `false` |
| `GROSSARY_ENCRYPTION_KEY` | AI API Key와 custom header 암호화 키. AI 연결을 쓰면 32자 이상 고정값 필요 |

oauth2-proxy 배포의 헤더명·nginx 덮어쓰기·계정 연결 설정은 [SSO 연결](/guide/sso)을
따른다.

용어 챗봇을 사용한다면 `GROSSARY_ENCRYPTION_KEY`를 먼저 생성해 `.env`와 운영 비밀
저장소에 보관한다. 이 값을 바꾸거나 잃으면 DB에 저장한 AI 비밀값을 복호화할 수 없다.
연결 방법은 [AI 활용과 챗봇](/guide/ai)을 따른다.

개발용 Postgres는 호스트 **5434** 포트에 뜬다(로컬에 이미 5432를 쓰는 Postgres가
있어도 부딪히지 않게 한 것이다).

## 3. Postgres 기동

```bash
docker compose up -d
```

`scripts/init-db.sql`이 초기화 시점에 `pg_trgm` 확장과 테스트 DB를 만든다.

::: warning
개발 머신에서 `docker-compose.prod.yml`로 `up`하지 마라. 두 파일이 같은 볼륨 이름
(`grossary_pgdata`)을 쓴다. 볼륨 이름은 디렉터리명 파생을 막으려고 일부러 고정되어
있고, 프로덕션은 자기 호스트에서 도는 것을 전제한다.
:::

## 4. 마이그레이션 적용

```bash
pnpm --filter @grossary/db db:migrate
```

스키마를 고쳤다면 마이그레이션을 먼저 생성한다.

```bash
pnpm --filter @grossary/db db:generate
```

## 5. 개발 서버

```bash
pnpm --filter @grossary/web dev
```

http://localhost:3000 에서 뜬다.

## 6. 최초 관리자 계정 만들기

계정을 미리 시딩할 필요 없다. 사용자가 하나도 없으면 첫 접속에서 자동으로
**`/setup`(관리자 만들기)** 화면으로 안내된다. 이메일·이름·비밀번호(8자 이상)를
입력하면 관리자 계정이 만들어지고 바로 로그인된다.

::: tip
`/setup`은 **사용자 테이블이 비어 있을 때만** 열린다. 첫 관리자가 생기면 그 뒤로는
`/setup`이 로그인으로 리다이렉트되고 `POST /api/v1/setup`은 403을 반환한다. 두 요청이
동시에 들어와도 advisory lock으로 직렬화되어 관리자는 한 번만 만들어진다.
:::

스크립트로(예: 헤드리스 프로비저닝) 만들고 싶으면 `scripts/seed-admin.ts`도 그대로
쓸 수 있다. 비밀번호는 명령행 인자로 넘기지 말고 `ADMIN_PASSWORD` 환경변수로 준다
(프로세스 목록·셸 히스토리에 평문으로 남는다).

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
pnpm --filter @grossary/web exec tsx scripts/seed-admin.ts admin@example.com
unset ADMIN_PASSWORD
```

### 나머지 사람들은 스스로 가입한다

관리자가 계정을 하나씩 발급하지 않는다. 로그인 화면의 **계정 만들기**로 누구나
`/signup`에서 계정을 만들고 바로 편집할 수 있다. 만들어지는 계정은 언제나 `editor`이고,
`admin`은 위의 최초 설정과 `seed-admin.ts`로만 생긴다(용어 삭제는 `admin`만 한다).

로그인을 요구하는 이유는 권한을 나누기 위해서가 아니라 **수정 이력에 이름을 남기기**
위해서다. 승인 절차가 없는 대신 모든 수정이 이력에 남고 언제든 되돌릴 수 있다.

회사 계정(OpenID Connect 또는 OAuth 2.0)으로 로그인하게 하려면 관리자로 **설정 → SSO**에서 붙인다 —
[SSO 연결](/guide/sso). 재배포 없이 화면에서 고치는 값이고, 이름·그룹을 어떤 claim에서
읽을지도 거기서 정한다(회사마다 `name` / `displayName` / `preferred_username`으로 갈린다).

## 7. 예시 용어집 채우기 (선택)

빈 표 앞에서는 무엇을 어떻게 적어야 할지 감이 오지 않는다. 손으로 고른 기본
용어집 세 묶음을 한 번에 넣을 수 있다.

```bash
pnpm --filter @grossary/web exec tsx scripts/seed-terms.ts all
```

| 묶음 키 | 용어집 | 담긴 것 |
|---|---|---|
| `general` | 일반 용어집 | 회의·문서·일정에서 매일 오가는 업무 공통어 |
| `it` | IT 용어집 | 개발·운영 기본어와 AI 용어 |
| `semiconductor` | 반도체 용어집 | 웨이퍼 공정부터 패키징·테스트까지의 현장어 |
| `all` | 위 전부 | |

원하는 묶음만 골라도 된다.

```bash
pnpm --filter @grossary/web exec tsx scripts/seed-terms.ts it semiconductor
```

인자 없이 실행하면 묶음 목록과 각 묶음의 용어 수를 찍고 끝난다.

::: tip
이미 있는 표기와 겹치는 용어는 건너뛴다. 두 번 실행해도 사본이 생기지 않고,
손으로 먼저 넣어 둔 용어를 덮어쓰지도 않는다.
:::

용어는 도메인(`일반` / `IT` / `반도체`)이 붙은 채 **사용**(`active`) 상태로 들어간다.
통째로 지우려면 목록에서 해당 도메인으로 거르면 된다. 작성자는 가장 먼저 만들어진
관리자 계정으로 기록되며, 관리자가 아직 없으면 작성자 없이 들어간다.

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm build` | 전체 워크스페이스 빌드 (Turborepo) |
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm docs:dev` | 이 문서 사이트를 로컬에서 띄운다 |
| `pnpm docs:build` | 문서 정적 빌드 (`docs/.vitepress/dist`) |
| `pnpm --filter @grossary/web exec tsx scripts/seed-terms.ts all` | 예시 용어집 세 묶음 넣기 |
| `pnpm --filter @grossary/engine test` | 정규화 엔진만 테스트 |
| `pnpm --filter @grossary/db test` | DB 통합 테스트 (Postgres 필요) |

`packages/db` 테스트는 실제 Postgres에 붙는다. 컨테이너가 떠 있지 않으면 실패한다.

## 화면

| 경로 | 역할 |
|---|---|
| `/` | 용어 검색 — 표기 하나를 지목해 찾는 홈 화면 |
| `/setup` | 최초 관리자 만들기 (사용자 0명일 때만) |
| `/login` | 로그인 |
| `/signup` | 계정 만들기 (누구나, 역할은 editor 고정) |
| `/sheet` | 시트 — 표 편집, type/domain/status 필터, 검색, 페이징 |
| `/new` | 용어 등록 |
| `/w/[slug]` | 용어 상세 (`?from=<표기>`로 어떤 표기에서 왔는지 표시) |
| `/edit/[slug]` | 편집 (낙관적 잠금) |
| `/history/[slug]` | 수정 이력 |
| `/import` | 엑셀 업로드 → dry-run 리포트 → 반영 |
| `/statistics` | 용어·사용자 성장과 도메인/업무 분류별 관리 통계 (관리자 전용) |
| `/settings` | 계정·화면 설정과 API 키 발급·폐기 |
| `/classifications` | 도메인과 업무 분류 관리 |
| `/settings/sso` | SSO 연결 설정 (관리자 전용) |
| `/admin` | 홈 문구, 업무 분류 목록과 사용자·세션 관리 (관리자 전용) |

옛 주소(`/terms`, `/terms/new`, `/terms/[slug]`, `/terms/[slug]/edit`,
`/terms/[slug]/history`)는 `next.config.ts`의 308 리다이렉트로 전부 새 주소에
연결된다 — 이미 공유된 링크는 그대로 열린다.
