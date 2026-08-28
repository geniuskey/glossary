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
ADMIN_EMAIL=admin@example.com pnpm --filter @grossary/web exec tsx scripts/seed-admin.ts
unset ADMIN_PASSWORD
```

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm build` | 전체 워크스페이스 빌드 (Turborepo) |
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm docs:dev` | 이 문서 사이트를 로컬에서 띄운다 |
| `pnpm docs:build` | 문서 정적 빌드 (`docs/.vitepress/dist`) |
| `pnpm --filter @grossary/engine test` | 정규화 엔진만 테스트 |
| `pnpm --filter @grossary/db test` | DB 통합 테스트 (Postgres 필요) |

`packages/db` 테스트는 실제 Postgres에 붙는다. 컨테이너가 떠 있지 않으면 실패한다.

## 화면

| 경로 | 역할 |
|---|---|
| `/` | 관리자 없으면 `/setup`, 있으면 `/terms`로 리다이렉트 |
| `/setup` | 최초 관리자 만들기 (사용자 0명일 때만) |
| `/login` | 로그인 |
| `/terms` | 용어 목록 — type/domain/status 필터, 검색, 페이징 |
| `/terms/new` | 용어 등록 |
| `/terms/[slug]` | 용어 상세 |
| `/terms/[slug]/edit` | 편집 (낙관적 잠금) |
| `/terms/[slug]/history` | 수정 이력 |
| `/import` | 엑셀 업로드 → dry-run 리포트 → 반영 |
| `/settings/api-keys` | API 키 발급·폐기 |
