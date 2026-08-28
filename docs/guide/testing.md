# 테스트

TDD로 진행한다. 테스트는 vitest로 돌리고 Turborepo가 패키지별로 묶는다.

```bash
pnpm test                             # 전체
pnpm --filter @grossary/engine test    # 정규화 엔진 (DB 불필요)
pnpm --filter @grossary/db test        # DB 통합 (Postgres 필요)
pnpm --filter @grossary/web test       # API·화면 (Postgres 필요)
```

## 테스트 DB는 분리되어 있다

`apps/web/tests/setup.ts`가 `DATABASE_URL_TEST`를 `DATABASE_URL`에 덮어쓴다.
환경변수가 없으면 테스트가 시작 자체를 거부한다.

```ts
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. 테스트는 개발 DB에 붙지 않습니다.");
}
process.env.DATABASE_URL = testUrl;
```

`grossary_test` DB는 `scripts/init-db.sql`이 Postgres 초기화 시점에 만든다.
DB에 붙는 패키지는 `fileParallelism: false`다 — 테스트가 같은 테이블을 건드린다.

## 어디에 무게를 싣나

| 계층 | 테스트 성격 |
|---|---|
| `packages/engine` | 순수 함수 단위 테스트. DB 없이 빠르게 돌고, 정확도 회귀가 가장 아픈 곳이다 |
| `packages/db` | 실제 Postgres 통합 테스트 |
| `apps/web` (API) | zod 스키마 기반 계약 테스트. 인증·scope 경계 포함 |
| `apps/web` (화면) | Server Component를 async 함수로 직접 호출해 엘리먼트 트리를 검사 |

## 구조를 잠그는 테스트들

손으로 유지되는 리터럴이나 규약은 코드 리뷰에 기대지 않고 테스트로 잠근다.

- **`packages/db/tests/normalize-parity.test.ts`** — 저장된 정규화 컬럼과
  `@grossary/engine`의 정규화 함수가 일치하는지 검증한다. 이 둘이 갈라지면 매칭이
  **에러 없이 조용히** 실패하므로, 이 저장소에서 가장 중요한 테스트다.
- **`apps/web/tests/openapi.test.ts`** — `app/api/v1/` 밑의 모든 라우트가 OpenAPI 스펙에
  있고 HTTP 메서드까지 일치하는지 검사한다. 라우트를 추가하고 스펙을 안 고치면 깨진다.
- **`apps/web/tests/screen-guards.test.ts`** — 상태를 바꾸는 GET 핸들러가 생기지 않게
  막는다. CSRF 방어가 `SameSite=Lax` 쿠키 하나뿐이라 이 규칙이 무너지면 방어가 없어진다.

## jsdom은 쓰지 않는다

렌더/이벤트 테스트는 하지 않는다. Server Component는 평범한 async 함수라 직접 호출해서
반환된 React 엘리먼트 트리(순수 객체)를 검사한다. 그래서 `esbuild: { jsx: "automatic" }`이
필요하다 — classic 변환이면 JSX가 `React.createElement` 참조 오류를 낸다.

E2E(Playwright)는 M2 이후 핵심 흐름 넷을 대상으로 붙인다:
용어 등록 → 별칭으로 검색 → 문서 검증 → 이력 롤백.
