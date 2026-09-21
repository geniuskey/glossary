# 시작하기

로컬 개발 환경을 세우는 절차다. 운영 배포는 [운영 안내서](/operations)를 본다.

## 요구사항

- Node.js **22 이상**
- pnpm: 저장소 루트 `package.json`의 `packageManager`에 지정된 버전
- Docker (Postgres 16 컨테이너용)

```bash
corepack enable
```

예제 명령은 Bash 기준이다. Windows에서는 Git Bash 또는 WSL을 사용한다. PowerShell을
사용한다면 아래 환경 파일 복사 명령만 `Copy-Item .env.example .env`로 바꾼다.

## 1. 저장소와 의존성 준비

```bash
git clone https://github.com/geniuskey/glossary.git
cd glossary
pnpm install
```

## 2. 환경 변수

```bash
cp .env.example .env
```

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | 앱이 붙는 개발 DB |
| `DATABASE_URL_TEST` | `packages/db`와 `apps/web` 테스트 전용 DB |
| `POSTGRES_PASSWORD` | 프로덕션 Compose에서만 쓴다 |
| `OAUTH2_PROXY_ENABLED` | 이 배포가 oauth2-proxy의 검증된 헤더를 받을 수 있는지. 기본 `false`; 실제 방식은 설정 화면에서 선택 |
| `PASSWORD_LOGIN_ENABLED` | 최초 부팅의 ID/비밀번호 로그인 초기값. 기본 `true`; 첫 관리자 로그인 후에는 관리자 패널 → 로그인 · SSO에서 관리 |
| `INITIAL_ADMIN_EMAIL` | SSO로 최초 생성할 관리자 이메일. 대소문자를 구분하지 않음 |
| `SSO_LOGIN_URL` | oauth2-proxy 로그인 진입점 재정의. 비우면 `/oauth2/start?rd=%2F` |
| `GLOSSARY_ENCRYPTION_KEY` | AI·RAG API Key와 custom header 암호화 키. AI 또는 RAG 연결을 쓰면 32자 이상 고정값 필요 |
| `GLOSSARY_ALLOWED_ORIGINS` | 로컬에서는 비워 두고, 운영 프록시 뒤에서는 쿠키 변경 요청을 허용할 실제 공개 HTTPS origin을 지정. 예: `https://glossary.example.com` |
| `GLOSSARY_TRUST_PROXY_HEADERS` | TLS 프록시가 덮어쓴 `X-Forwarded-*`를 신뢰할 때만 `true` |
| `GLOSSARY_AI_ALLOWED_PRIVATE_HOSTS` | 사설망에 있는 사내 AI·RAG 서버 호스트를 쉼표로 구분. 비우면 사설망 주소는 차단, `*`는 전부 허용 |
| `GLOSSARY_CONFLUENCE_MEETINGS_URL` | `/meetings`에서 열 회의록 허브의 Confluence URL. 선택 사항 |

oauth2-proxy 배포의 헤더명·nginx 덮어쓰기·계정 연결 설정은 [SSO 연결](/guide/sso)을
따른다.

용어 챗봇이나 RAG 검색을 사용한다면 `GLOSSARY_ENCRYPTION_KEY`를 먼저 생성해 `.env`와
운영 비밀 저장소에 보관한다. 이 값을 바꾸거나 잃으면 DB에 저장한 AI·RAG 비밀값을 복호화할 수 없다.
연결 방법은 [AI 활용과 챗봇](/guide/ai)을 따른다.

회의록은 Confluence를 원본으로 사용한다. `GLOSSARY_CONFLUENCE_MEETINGS_URL`을 설정하면
앱의 `/meetings` 회의 지식 인박스에서 회의록 허브로 바로 이동할 수 있다. Glossary에는
회의록 전체를 다시 저장하지 않고, 검토된 결정·원칙·용어만 위키와 용어집으로 승격한다.

개발용 Postgres는 호스트 **5434** 포트에 뜬다(로컬에 이미 5432를 쓰는 Postgres가
있어도 부딪히지 않게 한 것이다).

## 3. Postgres 기동

```bash
docker compose up -d
```

`scripts/init-db.sql`이 초기화 시점에 `pg_trgm`·`vector` 확장과 테스트 DB를 만든다.

::: warning
개발 머신에서 `docker-compose.prod.yml`로 `up`하지 마라. 두 파일이 같은 볼륨 이름
(`glossary_pgdata`)을 쓴다. 볼륨 이름은 디렉터리명 파생을 막으려고 일부러 고정되어
있고, 프로덕션은 자기 호스트에서 도는 것을 전제한다.
:::

## 4. 마이그레이션 적용

```bash
pnpm --filter @glossary/db db:migrate
```

스키마를 고쳤다면 마이그레이션을 먼저 생성한다.

```bash
pnpm --filter @glossary/db db:generate
```

## 5. 개발 서버

```bash
pnpm --filter @glossary/web dev
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
pnpm --filter @glossary/web exec tsx scripts/seed-admin.ts admin@example.com
unset ADMIN_PASSWORD
```

### 나머지 사람들은 스스로 가입한다

관리자가 계정을 하나씩 발급하지 않는다. 로그인 화면의 **계정 만들기**로 누구나
`/signup`에서 계정을 만들고 바로 편집할 수 있다. 만들어지는 계정은 언제나 `editor`이고,
`admin`은 위의 최초 설정과 `seed-admin.ts`로만 생긴다(용어 삭제는 `admin`만 한다).

::: warning
공개 가입은 비밀번호 로그인이 켜져 있는 동안 열려 있다. 사내 사용자가 자유롭게 참여하는
운영 방식이 아니라면 첫 관리자 생성 직후 **관리자 패널 → 로그인 · SSO**에서 회사 계정
로그인을 설정하고 비밀번호 로그인을 끈다.
:::

로그인을 요구하는 이유는 권한을 나누기 위해서가 아니라 **수정 이력에 이름을 남기기**
위해서다. 승인 절차가 없는 대신 모든 수정이 이력에 남고 언제든 되돌릴 수 있다.

회사 계정(OpenID Connect, OAuth 2.0 또는 oauth2-proxy)으로 로그인하게 하려면 관리자로 **관리자 패널 → 로그인 · SSO**에서 붙인다 —
[SSO 연결](/guide/sso). 재배포 없이 화면에서 고치는 값이고, 이름·그룹을 어떤 claim에서
읽을지도 거기서 정한다(회사마다 `name` / `displayName` / `preferred_username`으로 갈린다).

## 7. 예시 용어집 채우기 (선택)

빈 표 앞에서는 무엇을 어떻게 적어야 할지 감이 오지 않는다. 손으로 고른 기본
용어집 세 묶음을 한 번에 넣을 수 있다.

```bash
pnpm --filter @glossary/web exec tsx scripts/seed-terms.ts all
```

| 묶음 키 | 용어집 | 담긴 것 |
|---|---|---|
| `general` | 일반 용어집 | 회의·문서·일정에서 매일 오가는 업무 공통어 |
| `it` | IT 용어집 | 개발·운영 기본어와 AI 용어 |
| `semiconductor` | 반도체 용어집 | 웨이퍼 공정부터 패키징·테스트까지의 현장어 |
| `all` | 위 전부 | |

원하는 묶음만 골라도 된다.

```bash
pnpm --filter @glossary/web exec tsx scripts/seed-terms.ts it semiconductor
```

인자 없이 실행하면 묶음 목록과 각 묶음의 용어 수를 찍고 끝난다.

::: tip
이미 있는 표기와 겹치는 용어는 건너뛴다. 두 번 실행해도 사본이 생기지 않고,
손으로 먼저 넣어 둔 용어를 덮어쓰지도 않는다.
:::

용어는 도메인(`일반` / `IT` / `반도체`)이 붙은 채 **사용**(`active`) 상태로 들어간다.
통째로 지우려면 목록에서 해당 도메인으로 거르면 된다. 작성자는 가장 먼저 만들어진
관리자 계정으로 기록되며, 관리자가 아직 없으면 작성자 없이 들어간다.

## 8. 설치 후 10분 확인

설치가 끝났는지만 보는 대신 제품의 핵심 흐름을 한 번 통과한다.

1. `/setup`에서 첫 관리자 계정을 만든다.
2. 위 시드 명령으로 예시 용어를 넣고 `/sheet`에서 한·영 표기, 별칭과 도메인을 확인한다.
3. 홈에서 약어나 별칭을 검색해 같은 용어 상세로 이동하는지 확인한다.
4. `/new`에서 조직에서 실제로 쓰는 용어 하나를 등록한다.
5. `/check`에 짧은 마크다운 문서를 붙여 넣고 비표준 표기와 미등록 후보를 확인한다.
6. 미등록 후보 하나를 용어로 등록하거나 무시한 뒤 문서를 다시 점검한다.

여기까지 동작하면 앱·DB·인증·검색·검증 엔진의 기본 경로가 모두 준비된 것이다. AI와
RAG 연결은 이 흐름에 필요하지 않으며, 기본 사용을 확인한 뒤 선택해서 설정한다.

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm build` | 전체 워크스페이스 빌드 (Turborepo) |
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm docs:dev` | 이 문서 사이트를 로컬에서 띄운다 |
| `pnpm docs:build` | 문서 정적 빌드 (`docs/.vitepress/dist`) |
| `pnpm --filter @glossary/web exec tsx scripts/seed-terms.ts all` | 예시 용어집 세 묶음 넣기 |
| `pnpm --filter @glossary/engine test` | 정규화 엔진만 테스트 |
| `pnpm --filter @glossary/db test` | DB 통합 테스트 (Postgres 필요) |

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
| `/g/[slug]` | 용어 상세 (`?from=<표기>`로 어떤 표기에서 왔는지 표시) |
| `/w/[slug]` | 업무 맥락을 쌓는 위키 문서 상세 |
| `/edit/[slug]` | 편집 (낙관적 잠금) |
| `/history/[slug]` | 수정 이력 |
| `/import` | 엑셀 업로드 → dry-run 리포트 → 반영 |
| `/statistics` | 용어·사용자 성장과 도메인/업무 분류별 관리 통계 (관리자 전용) |
| `/settings` | 계정·화면 설정과 API 키 발급·폐기 |
| `/classifications` | 도메인과 업무 분류 관리 |
| `/contribute` | 함께 정리 — 정리 대기 표와 보완할 용어 필터 |
| `/contribute?tab=agent` | 제안 검토 — 검토 대상 목록과 AI·규칙 제안 승인 |
| `/contribute?tab=duplicates` | 중복 후보 검토 — 후보 쌍 비교·병합·분리·보류 |
| `/contribute?tab=queue` | AI 작업 링크 — 검토 필요·대기·처리·실패 상태 |
| `/contribute/fields` | 필드 보완 — 한줄 정의·도메인·업무 분류 작업 선택 |
| `/contribute/fields?field=definition` | 필드 보완: 한줄 정의 — 본문 근거와 LLM 제안 표 |
| `/contribute/fields?field=domain` | 필드 보완: 도메인 — 도메인이 비어 있는 용어 분류 |
| `/contribute/fields?field=category` | 필드 보완: 업무 분류 — 업무 분류가 비어 있는 용어 분류 |
| `/admin` | 운영 개요와 관리자 설정 메뉴 (관리자 전용) |
| `/admin?tab=home` | 홈 콘텐츠 문구 설정 |
| `/admin?tab=menus` | 사용자 사이드바 메뉴 표시 설정 |
| `/admin?tab=quality` | 콘텐츠 완성도 기준과 충족 현황 |
| `/admin?tab=ai` | AI 공급자·모델·자동 검토 설정 |
| `/admin?tab=rag` | 검색 인프라 — Embedding·Reranker·벡터 색인 설정 |
| `/admin?tab=observability` | AI 운영 — 호출·큐·실패 현황 |
| `/admin?tab=data` | 서버 전체 용어집 읽기 전용 스냅샷 다운로드 (관리자 전용) |
| `/admin?tab=sso` | 관리자 패널의 SSO 연결 탭 (`/settings/sso`는 이 주소로 이동) |

옛 주소(`/terms`, `/terms/new`, `/terms/[slug]`, `/terms/[slug]/edit`,
`/terms/[slug]/history`)는 `next.config.ts`의 308 리다이렉트로 전부 새 주소에
연결된다 — 이미 공유된 링크는 그대로 열린다.
