# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령

```bash
pnpm install                          # corepack enable 선행
docker compose up -d                  # Postgres 16 + pg_trgm, 호스트 5434
pnpm --filter @glossary/db db:migrate
pnpm --filter @glossary/web dev       # http://localhost:3000

pnpm build | pnpm test | pnpm typecheck     # 전체 (Turborepo)
pnpm --filter @glossary/web test            # 워크스페이스 하나만
pnpm --filter @glossary/web exec vitest run tests/terms-grid.test.ts   # 파일 하나
pnpm --filter @glossary/web exec vitest run -t "위로 연다"             # 테스트 하나

pnpm --filter @glossary/db db:generate      # 스키마 변경 후 마이그레이션 생성
pnpm --filter @glossary/web exec tsx scripts/seed-terms.ts all   # 예시 용어집 93개
pnpm docs:dev                               # VitePress 문서
```

`apps/web`과 `packages/db` 테스트는 실제 Postgres에 붙는다. `DATABASE_URL_TEST`가 없으면
`tests/setup.ts`가 시작 자체를 거부한다 — 테스트는 개발 DB에 붙지 않는다.

```bash
DATABASE_URL_TEST='postgres://glossary:glossary@localhost:5434/glossary_test' \
  pnpm --filter @glossary/web test
```

`.env`는 루트 하나뿐이다. `apps/web`은 `next.config.ts`가, 스크립트는 각자
`process.loadEnvFile`로 루트 `.env`를 읽는다.

## 아키텍처

의존 방향은 `web → db → engine` 한 방향. `engine`은 아무것도 의존하지 않는다.

**개념(Term)과 표기(Surface)의 분리가 이 제품의 축이다.** 엑셀이 무너진 이유는 한 행이
개념이자 표기였기 때문이다. `terms` 한 행에 `term_surfaces` 여러 행이 달리고, 검색·중복
검사·`/terms/lookup`은 전부 표기 쪽 정규화 키(`norm_loose` / `norm_space`)로 돈다.

**정규화 함수의 유일한 소유자는 `packages/engine`이다.** DB에 `norm_loose`를 쓸 때 쓴
함수와 문서를 정규화하는 함수가 조금이라도 갈라지면 매칭이 **에러 없이 조용히** 실패한다.
`packages/db/tests/normalize-parity.test.ts`가 이 일치를 상시 검증한다. 정규화 규칙을
고칠 일이 있으면 `engine`에서만 고친다.

**모든 쓰기는 리비전을 남긴다.** `createTerm` / `updateTerm`은 terms + term_surfaces +
term_revisions를 한 트랜잭션으로 묶는다(부분 저장 금지 — 리비전 0개인 term은
`revisionNumber = max + 1` 계산을 깬다). 동시 수정은 `expectedRevision`으로 낙관적
동시성 제어를 하고 어긋나면 409 `revision_conflict`.

### API 규약 (`apps/web/src/app/api/v1`)

- 모든 에러는 `{ error: { code, message, details? } }`. **예외 없음** — 매칭 안 되는
  경로까지 `[...unmatched]/route.ts`가 JSON 404로 받는다.
- 라우트는 처리하지 않는 메서드를 `methodStubs()`로 명시 export한다. Next 기본 405는
  본문이 비어 있고, 손으로 스텁을 쓰면 `Allow` 헤더가 실제와 어긋난다.
- 인증 두 갈래 — 사람은 세션 쿠키, 도구는 `Authorization: Bearer glk_<prefix>_<secret>`.
  라우트에서는 `requireAuth(request, scope)` 하나로 처리한다.
- OpenAPI 스펙(`src/lib/openapi.ts`)은 손으로 유지되지만 `tests/openapi.test.ts`가
  라우트 디렉터리와 대조한다. 라우트를 추가하면 스펙도 추가해야 테스트가 통과한다.

### 테스트 스타일

jsdom이 없다(의도적). 렌더/이벤트 테스트 대신 **구조 테스트**를 쓴다 — 순수 함수를
직접 부르거나, Server Component를 async 함수로 호출해 반환된 엘리먼트 트리를 검사하거나,
파일시스템/리터럴을 grep해 "손으로 유지되는 두 곳이 어긋나지 않았는가"를 잠근다.
UI 로직은 테스트 가능한 순수 함수로 빼는 편이다(`src/lib/terms/grid.ts` 참고).

## 코드 컨벤션

주석은 **"왜"만 적는다.** 무엇을 하는지는 코드가 말한다. 이 저장소의 주석은 대부분
"이렇게 안 하면 무엇이 조용히 깨지는가"를 실측과 함께 남긴 것이고, `R29`, `R86` 같은
리뷰 번호로 출처를 표시한다. 같은 종류의 함정을 다시 만나면 같은 형식으로 남긴다.

주석과 사용자에게 보이는 문자열은 한국어. 커밋 메시지는 영어.

## Next.js 16

`apps/web/AGENTS.md`가 요구한다 — 이 버전은 학습 데이터의 Next.js와 다르다. 코드를 쓰기
전에 `apps/web/node_modules/next/dist/docs/`의 해당 가이드를 읽는다. 이 블록은
`next dev`가 다시 써 넣으므로 diff에서 지워도 되살아난다. 작업과 함께 커밋한다.
