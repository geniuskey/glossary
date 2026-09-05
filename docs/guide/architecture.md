# 아키텍처

## 저장소 구조

pnpm workspace + Turborepo 모노레포다.

```
apps/web/          Next.js 16 App Router — UI + API 라우트 + zod 스키마 + OpenAPI 스펙
packages/db/       Drizzle 스키마 + 마이그레이션 + 쿼리
packages/engine/   순수 TS — 표기 정규화, (M2) 매칭·경계 판정·규칙
docs/              이 문서 사이트 (VitePress)
scripts/           init-db.sql, backup.sh, restore.sh
```

의존 방향은 한 방향이다.

```
web  →  db  →  engine
```

`engine`은 아무것도 의존하지 않는다. DB도 HTTP도 모른다.

## 반드시 지켜야 할 제약: 정규화 함수의 단일 소유

표기 정규화 함수는 **`engine`이 유일한 소유자**이고 `db`가 이를 import해서 쓴다.

```ts
// packages/db/src/index.ts
import { normalizeSurface } from "@glossary/engine";

export function surfaceKeys(text: string): { normLoose: string; normSpace: string } {
  const { loose, space } = normalizeSurface(text);
  return { normLoose: loose, normSpace: space };
}
```

DB에 `norm_loose`를 저장할 때 쓴 함수와 검증 시 문서를 정규화하는 함수가 조금이라도
다르면 **매칭이 조용히 실패한다.** 에러 없이 그냥 용어를 못 찾는다. 그래서
`packages/db/tests/normalize-parity.test.ts`가 저장된 정규화 컬럼과 엔진 함수의 일치를
상시 검증한다. 정규화 규칙을 바꿀 때는 저장된 정규화 컬럼을 재생성하는 마이그레이션을
반드시 함께 넣는다.

## 정규화 절차

`NFKC → CamelCase 분해 → 소문자 → 구분자 처리 두 갈래`

```ts
normalizeSurface("Auto Exposure")  // { loose: "autoexposure", space: "auto exposure" }
normalizeSurface("auto-exposure")  // { loose: "autoexposure", space: "auto exposure" }
normalizeSurface("AutoExposure")   // { loose: "autoexposure", space: "auto exposure" }
```

구분자로 취급하는 문자는 공백류와 `- _ / . · ・`다. 세 표기가 한 키로 수렴하므로
사람이 어떻게 쓰든 같은 개념에 도달한다.

## API 계층의 규약

### 에러 봉투

전 엔드포인트가 같은 형태를 쓴다. 예외 없음.

```json
{ "error": { "code": "not_found", "message": "...", "details": {} } }
```

`code`는 기계가 분기할 수 있는 안정된 문자열이다. 전체 목록은
[API 개요](/api/#에러-규약)에 있다.

이 규약을 예외 없이 지키기 위해 두 개의 헬퍼가 `apps/web/src/lib/api-error.ts`에 있다.

- **`withApiErrors`** — 라우트가 던진 예외를 본문 있는 JSON 500으로 바꾼다. Next에서
  던져진 예외는 기본적으로 본문 없는 500이 되어 규약을 깬다.
- **`methodStubs`** — 라우트가 처리하지 않는 메서드를 명시적으로 405로 만든다.
  Next의 기본 405는 0바이트 본문에 content-type도 없다. 이 헬퍼가 만드는 `OPTIONS`가
  Next의 자동 생성을 덮어써서 `Allow` 헤더가 실제 허용 메서드와 항상 일치한다.

### 4xx와 5xx의 경계

재시도해도 절대 성공하지 않는 입력은 5xx가 아니라 4xx다. 형식이 잘못된 UUID를 그대로
쿼리에 넘기면 Postgres가 예외를 던지고 500이 되는데, 이건 기계 클라이언트에게
"나중에 다시 시도하라"는 틀린 신호다. `requireUuid`가 미리 걸러 404로 답한다.

### 같은 입력, 다른 실패 신호

`?type=foo` 같은 알 수 없는 enum 값을,

- **API 라우트**(`apps/web/src/app/api/v1/terms/route.ts`)는 400 `validation_failed`로
  거절한다. 기계 클라이언트의 타이핑 실수가 조용히 묻히면 안 된다.
- **화면**(`apps/web/src/lib/terms/list-params.ts`)은 조용히 무시하고 기본값을 쓴다.
  사람이 주소창을 손으로 고치다 낸 오타 하나로 에러 페이지를 띄우면 안 된다.

같은 로직처럼 보여도 실패 시 동작이 달라야 해서 모듈이 둘로 나뉘어 있다.
API 파서를 화면에서 재사용하지 마라.

### 내부 컬럼 유출 차단

쓰기 응답은 DB 원시 행을 그대로 싣지 않는다. `apps/web/src/lib/terms/wire.ts`의
`toTermWire`/`toSurfaceWire`가 필드를 골라내므로 `createdBy`/`updatedBy`/`normLoose`
같은 내부 컬럼이 새지 않는다. `updatedAt`은 ISO 문자열로 명시 직렬화한다.

## OpenAPI 스펙

스펙은 `apps/web/src/lib/openapi.ts`에 TypeScript 객체로 손수 유지하고
`GET /api/v1/openapi`가 그 객체를 그대로 서빙한다. yaml 파일이 아닌 이유는 둘이다.

1. standalone 이미지는 `docs/*.yaml`을 추적하지 않아 런타임에 읽을 수 없다.
2. 구조 테스트가 **실제로 서빙되는 바로 그 객체**를 읽으므로 문서와 응답이 갈라질 수 없다.

`apps/web/tests/openapi.test.ts`가 `app/api/v1/` 밑의 모든 라우트가 스펙에 있고
메서드까지 일치하는지 검사한다. 라우트를 추가하고 스펙을 안 고치면 테스트가 깨진다.

## 인프라

컨테이너는 둘뿐이다. PostgreSQL 16 + `pg_trgm`, 그리고 Next.js standalone 빌드.

```yaml
volumes:
  pgdata:
    name: glossary_pgdata   # 디렉터리명 파생 방지 — 명시 고정
```

볼륨 `name:` 명시는 사고 방지용이다. Compose 볼륨명은 기본적으로 프로젝트 디렉터리명에서
파생되므로, 디렉터리를 옮기거나 이름을 고치면 빈 볼륨이 새로 생성되고 앱은 멀쩡히 뜬 채
데이터만 사라진다.

첨부 이미지까지 Postgres에 들어 있어서 **`pg_dump -Fc` 결과 파일 하나가 전체 백업**이고
서버 이동은 `pg_restore` 하나다. 절차는 [운영 안내서](/operations)에 있다.
