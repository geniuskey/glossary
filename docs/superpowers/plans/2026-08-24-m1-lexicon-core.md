# M1 사전 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엑셀·컨플루언스 용어집을 이관해 실사용을 시작할 수 있는 단일 사전(용어 CRUD + 표기 기반 검색 + 중복 경고 + 엑셀 임포트)을 완성한다.

**Architecture:** pnpm 워크스페이스 모노레포. `packages/engine`은 의존성 없는 순수 TS로 표기 정규화를 소유하고, `packages/db`가 이를 import해 Drizzle 스키마의 정규화 컬럼을 채운다. `apps/web`(Next.js App Router)이 UI와 `/api/v1` 라우트를 함께 제공한다. 사람은 세션 쿠키로, 도구는 API Key로 인증한다.

**Tech Stack:** pnpm 9 / Turborepo / TypeScript 5(strict) / Vitest / PostgreSQL 16 + pg_trgm / Drizzle ORM + postgres.js / Next.js 16 App Router / Tailwind + shadcn/ui / zod / exceljs / Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-24-glossary-platform-design.md`

## Global Constraints

- Node 22 LTS. 패키지 매니저는 pnpm 고정 (`packageManager` 필드 명시).
- TypeScript strict mode. 전 패키지 공통 `tsconfig.base.json` 상속.
- 의존 방향은 `web → db → engine`. **engine은 어떤 워크스페이스 패키지도 의존하지 않는다.**
- **표기 정규화 함수는 `packages/engine`이 유일한 소유자다.** `packages/db`는 이를 import해서만 쓴다. 정규화 구현이 두 곳에 생기면 매칭이 에러 없이 조용히 실패한다.
- DB 볼륨은 `name: grossary_pgdata`로 명시 고정. 디렉터리명 파생 금지.
- 용어 상태는 `draft | approved | deprecated | forbidden`, 표기 종류는 `canonical | abbreviation | full_name | alias | discouraged | forbidden`, 용어 종류는 `term | abbreviation | project | product_id | code | unit`.
- API 에러는 전 엔드포인트가 `{ error: { code, message, details? } }` 형태로 통일한다.
- API Key 형식은 `glk_<prefix>_<secret>`이며 DB에는 해시만 저장한다.
- 커밋 메시지는 영어 `type: description` 형식.

---

### Task 1: 모노레포 스캐폴딩

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts`, `packages/engine/tests/smoke.test.ts`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces: `pnpm test`, `pnpm build`, `pnpm typecheck` 스크립트가 루트에서 동작. 워크스페이스 패키지명 `@grossary/engine`.

- [ ] **Step 1: 루트 설정 파일 생성**

`package.json`:
```json
{
  "name": "grossary",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.next/
.turbo/
*.tsbuildinfo
.env
.env.local
backups/
```

`.npmrc`:
```
strict-peer-dependencies=false
```

- [ ] **Step 2: engine 패키지 생성**

`packages/engine/package.json`:
```json
{
  "name": "@grossary/engine",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
```

`packages/engine/src/index.ts`:
```ts
export const ENGINE_VERSION = "0.0.0";
```

- [ ] **Step 3: 스모크 테스트 작성**

`packages/engine/tests/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
import { ENGINE_VERSION } from "../src/index.js";

test("engine package is wired up", () => {
  expect(ENGINE_VERSION).toBe("0.0.0");
});
```

- [ ] **Step 4: 설치 후 테스트 실행**

Run: `pnpm install && pnpm test`
Expected: engine 패키지 테스트 1개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace with engine package"
```

---

### Task 2: 표기 정규화 함수

전체 시스템에서 가장 중요한 함수다. 여기서 정한 규칙이 DB 컬럼 값과 검색 매칭을 동시에 결정한다.

**Files:**
- Create: `packages/engine/src/normalize.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/tests/normalize.test.ts`

**Interfaces:**
- Consumes: Task 1의 `@grossary/engine` 패키지 구조
- Produces:
  ```ts
  export interface NormalizedSurface { loose: string; space: string }
  export function normalizeSurface(text: string): NormalizedSurface
  ```
  Task 3의 DB 컬럼 `norm_loose` / `norm_space`가 각각 `loose` / `space`를 저장한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/engine/tests/normalize.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { normalizeSurface } from "../src/normalize.js";

describe("normalizeSurface", () => {
  test("표기 변형이 하나로 수렴한다", () => {
    const variants = ["Auto Exposure", "auto-exposure", "AutoExposure", "auto_exposure"];
    for (const v of variants) {
      expect(normalizeSurface(v)).toEqual({ loose: "autoexposure", space: "auto exposure" });
    }
  });

  test("대문자 약어는 그대로 소문자화된다", () => {
    expect(normalizeSurface("AE")).toEqual({ loose: "ae", space: "ae" });
    expect(normalizeSurface("AWB")).toEqual({ loose: "awb", space: "awb" });
  });

  test("연속 대문자 뒤 단어 경계를 분리한다", () => {
    expect(normalizeSurface("MIPIRx")).toEqual({ loose: "mipirx", space: "mipi rx" });
    expect(normalizeSurface("MIPI Rx")).toEqual({ loose: "mipirx", space: "mipi rx" });
  });

  test("숫자와 문자 경계를 분리하지 않는다", () => {
    expect(normalizeSurface("IMX999")).toEqual({ loose: "imx999", space: "imx999" });
  });

  test("한글은 결합 형태로 유지하고 공백만 처리한다", () => {
    expect(normalizeSurface("이미지 센서")).toEqual({ loose: "이미지센서", space: "이미지 센서" });
    expect(normalizeSurface("이미지센서")).toEqual({ loose: "이미지센서", space: "이미지센서" });
  });

  test("전각 문자를 반각으로 정규화한다", () => {
    expect(normalizeSurface("ＡＥ")).toEqual({ loose: "ae", space: "ae" });
  });

  test("앞뒤 공백과 연속 공백을 정리한다", () => {
    expect(normalizeSurface("  Auto   Exposure  ")).toEqual({
      loose: "autoexposure",
      space: "auto exposure",
    });
  });

  test("빈 문자열과 구분자만 있는 입력을 견딘다", () => {
    expect(normalizeSurface("")).toEqual({ loose: "", space: "" });
    expect(normalizeSurface(" - _ ")).toEqual({ loose: "", space: "" });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm --filter @grossary/engine test`
Expected: FAIL — `Cannot find module '../src/normalize.js'`

- [ ] **Step 3: 구현**

`packages/engine/src/normalize.ts`:
```ts
export interface NormalizedSurface {
  /** 구분자를 모두 제거한 키. "auto-exposure" -> "autoexposure" */
  loose: string;
  /** 구분자를 단일 공백으로 축약한 키. "auto-exposure" -> "auto exposure" */
  space: string;
}

const SEPARATORS = /[\s\-_/.·・]+/g;

function splitCamelCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function normalizeSurface(text: string): NormalizedSurface {
  const nfkc = text.normalize("NFKC");
  const spaced = splitCamelCase(nfkc)
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .trim();

  return { loose: spaced.replace(/ /g, ""), space: spaced };
}
```

`splitCamelCase`를 소문자화 **전에** 적용하는 것이 핵심이다. 순서가 바뀌면 대소문자 정보가 사라져 `AutoExposure`를 분리할 수 없다. 숫자→대문자 경계(`IMX999`)는 첫 정규식의 `[a-z0-9]` 앞부분에만 걸리므로 `999`처럼 뒤에 대문자가 없으면 분리되지 않는다.

- [ ] **Step 4: index에서 export하고 테스트 통과 확인**

`packages/engine/src/index.ts`:
```ts
export const ENGINE_VERSION = "0.0.0";
export { normalizeSurface } from "./normalize.js";
export type { NormalizedSurface } from "./normalize.js";
```

Run: `pnpm --filter @grossary/engine test`
Expected: 정규화 테스트 8개 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/engine
git commit -m "feat: add surface normalization with loose and spaced keys"
```

---

### Task 3: Postgres 컨테이너 + 용어 스키마 + 정규화 일치 검증

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `scripts/init-db.sql`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`, `packages/db/src/schema/terms.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Test: `packages/db/tests/normalize-parity.test.ts`

**Interfaces:**
- Consumes: `normalizeSurface` from `@grossary/engine`
- Produces:
  - `terms`, `termSurfaces` Drizzle 테이블
  - `export function createDb(url: string)` → Drizzle 인스턴스
  - `export function surfaceKeys(text: string)` → `{ normLoose, normSpace }` (engine 위임 래퍼)

- [ ] **Step 1: Docker Compose와 환경 파일 작성**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: grossary
      POSTGRES_PASSWORD: grossary
      POSTGRES_DB: grossary
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U grossary"]
      interval: 5s
      retries: 10

volumes:
  pgdata:
    name: grossary_pgdata
```

`scripts/init-db.sql` — 볼륨이 비어 있는 최초 기동 때 한 번만 실행된다. pg_trgm은 마이그레이션보다 먼저 있어야 trgm 인덱스가 생성된다:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE DATABASE grossary_test;
\connect grossary_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

`.env.example`:
```
DATABASE_URL=postgres://grossary:grossary@localhost:5432/grossary
DATABASE_URL_TEST=postgres://grossary:grossary@localhost:5432/grossary_test
POSTGRES_PASSWORD=grossary
```

`grossary_test`는 개발 환경 편의를 위한 것이다. 프로덕션 compose는 같은 init 스크립트를 쓰지 않는다(Task 15에서 별도 지정).

- [ ] **Step 2: db 패키지와 스키마 작성**

`packages/db/package.json`:
```json
{
  "name": "@grossary/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@grossary/engine": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "tests/**/*", "drizzle.config.ts"]
}
```

`packages/db/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
```

`packages/db/src/schema/terms.ts`:
```ts
import { sql } from "drizzle-orm";
import {
  boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const termTypeEnum = pgEnum("term_type", [
  "term", "abbreviation", "project", "product_id", "code", "unit",
]);

export const termStatusEnum = pgEnum("term_status", [
  "draft", "approved", "deprecated", "forbidden",
]);

export const surfaceKindEnum = pgEnum("surface_kind", [
  "canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden",
]);

export const surfaceLangEnum = pgEnum("surface_lang", ["en", "ko", "neutral"]);

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    termType: termTypeEnum("term_type").notNull().default("term"),
    nameEn: text("name_en"),
    nameKo: text("name_ko"),
    fullNameEn: text("full_name_en"),
    fullNameKo: text("full_name_ko"),
    domain: text("domain").array().notNull().default([]),
    status: termStatusEnum("status").notNull().default("draft"),
    definitionMd: text("definition_md"),
    bodyMd: text("body_md"),
    replacedById: uuid("replaced_by_id"),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("terms_slug_unique").on(t.slug),
    statusIdx: index("terms_status_idx").on(t.status),
  }),
);

export const termSurfaces = pgTable(
  "term_surfaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    lang: surfaceLangEnum("lang").notNull().default("neutral"),
    kind: surfaceKindEnum("kind").notNull().default("alias"),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    normLoose: text("norm_loose").notNull(),
    normSpace: text("norm_space").notNull(),
  },
  (t) => ({
    looseIdx: index("term_surfaces_norm_loose_idx").on(t.normLoose),
    spaceIdx: index("term_surfaces_norm_space_idx").on(t.normSpace),
    looseTrgm: index("term_surfaces_norm_loose_trgm")
      .using("gin", sql`${t.normLoose} gin_trgm_ops`),
    termIdx: index("term_surfaces_term_idx").on(t.termId),
    uniquePerTerm: uniqueIndex("term_surfaces_unique").on(t.termId, t.normLoose, t.kind),
  }),
);
```

`packages/db/src/schema/index.ts`:
```ts
export * from "./terms.js";
```

`packages/db/src/client.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(url: string) {
  const sql = postgres(url, { max: 10 });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

`packages/db/src/index.ts`:
```ts
import { normalizeSurface } from "@grossary/engine";

export * from "./schema/index.js";
export { createDb } from "./client.js";
export type { Db } from "./client.js";

/**
 * 표기 정규화 컬럼 값을 만든다.
 * 정규화 규칙 자체는 @grossary/engine이 소유한다. 여기서 재구현하지 말 것.
 */
export function surfaceKeys(text: string): { normLoose: string; normSpace: string } {
  const { loose, space } = normalizeSurface(text);
  return { normLoose: loose, normSpace: space };
}
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 3: 정규화 일치 테스트 작성 (이 태스크의 핵심)**

`packages/db/tests/normalize-parity.test.ts`:
```ts
import { normalizeSurface } from "@grossary/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, surfaceKeys, terms, termSurfaces } from "../src/index.js";

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error("DATABASE_URL_TEST is required");
const db = createDb(url);

let termId: string;

beforeAll(async () => {
  const [row] = await db
    .insert(terms)
    .values({ slug: `parity-${Date.now()}`, nameEn: "Auto Exposure", status: "approved" })
    .returning();
  termId = row!.id;
});

afterAll(async () => {
  await db.delete(terms).where(eq(terms.id, termId));
});

test("저장된 정규화 컬럼이 engine 함수 출력과 정확히 일치한다", async () => {
  const inputs = ["Auto Exposure", "auto-exposure", "AutoExposure", "이미지 센서", "IMX999"];

  await db.insert(termSurfaces).values(
    inputs.map((text) => ({ termId, text, kind: "alias" as const, ...surfaceKeys(text) })),
  );

  const rows = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, termId));

  for (const row of rows) {
    const expected = normalizeSurface(row.text);
    expect(row.normLoose).toBe(expected.loose);
    expect(row.normSpace).toBe(expected.space);
  }
});
```

이 테스트는 형식적으로 보이지만 목적이 분명하다. 누군가 `db` 안에 정규화를 재구현하면 즉시 깨진다. 정규화 규칙을 바꿀 때는 이 테스트가 통과하도록 저장 컬럼 재생성 마이그레이션을 함께 넣어야 한다.

- [ ] **Step 4: DB 기동, 마이그레이션 생성·적용, 테스트 실행**

```bash
cp .env.example .env
docker compose up -d postgres          # init-db.sql이 pg_trgm과 grossary_test를 만든다
pnpm install
pnpm --filter @grossary/engine build   # db 테스트가 engine의 dist를 import한다
pnpm --filter @grossary/db db:generate
DATABASE_URL=postgres://grossary:grossary@localhost:5432/grossary pnpm --filter @grossary/db db:migrate
DATABASE_URL=postgres://grossary:grossary@localhost:5432/grossary_test pnpm --filter @grossary/db db:migrate
DATABASE_URL_TEST=postgres://grossary:grossary@localhost:5432/grossary_test pnpm --filter @grossary/db test
```
Expected: parity 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add postgres schema for terms and surfaces with normalization parity test"
```

---

### Task 4: 사용자·세션·API 키·리비전 스키마

**Files:**
- Create: `packages/db/src/schema/auth.ts`, `packages/db/src/schema/revisions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/tests/schema-shape.test.ts`

**Interfaces:**
- Consumes: Task 3의 `terms` 테이블, `createDb`
- Produces: `users`, `sessions`, `apiKeys`, `termRevisions` 테이블

- [ ] **Step 1: 인증 스키마 작성**

`packages/db/src/schema/auth.ts`:
```ts
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "editor"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("editor"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailUnique: uniqueIndex("users_email_unique").on(t.email) }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ userIdx: index("sessions_user_idx").on(t.userId) }),
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({ prefixUnique: uniqueIndex("api_keys_prefix_unique").on(t.prefix) }),
);
```

- [ ] **Step 2: 리비전 스키마 작성**

`packages/db/src/schema/revisions.ts`:
```ts
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { terms } from "./terms.js";
import { users } from "./auth.js";

export const termRevisions = pgTable(
  "term_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    message: text("message"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perTerm: uniqueIndex("term_revisions_unique").on(t.termId, t.revisionNumber),
    termIdx: index("term_revisions_term_idx").on(t.termId),
  }),
);
```

용어 간 관계(`term_relations`)는 M1에 소비자가 없다. 위키 링크와 백링크를 붙이는 M3에서
그때 필요한 형태로 만든다.

`packages/db/src/schema/index.ts`:
```ts
export * from "./terms.js";
export * from "./auth.js";
export * from "./revisions.js";
```

- [ ] **Step 3: 스키마 형태 테스트 작성**

`packages/db/tests/schema-shape.test.ts`:
```ts
import { expect, test } from "vitest";
import { createDb, apiKeys, sessions, termRevisions, users } from "../src/index.js";

const db = createDb(process.env.DATABASE_URL_TEST!);

test("모든 신규 테이블에 조회가 가능하다", async () => {
  for (const table of [users, sessions, apiKeys, termRevisions]) {
    const rows = await db.select().from(table).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  }
});
```

- [ ] **Step 4: 마이그레이션 생성·적용 후 테스트**

```bash
pnpm --filter @grossary/db db:generate
DATABASE_URL=postgres://grossary:grossary@localhost:5432/grossary pnpm --filter @grossary/db db:migrate
DATABASE_URL=postgres://grossary:grossary@localhost:5432/grossary_test pnpm --filter @grossary/db db:migrate
DATABASE_URL_TEST=postgres://grossary:grossary@localhost:5432/grossary_test pnpm --filter @grossary/db test
```
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add auth and revision schemas"
```

---

### Task 5: Next.js 앱 + 에러 규약 + health 엔드포인트

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`
- Create: `apps/web/vitest.config.ts`, `apps/web/tests/setup.ts`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/db.ts`, `apps/web/src/lib/api-error.ts`
- Create: `apps/web/src/app/api/v1/health/route.ts`
- Test: `apps/web/tests/api-error.test.ts`

**Interfaces:**
- Consumes: `@grossary/db`의 `createDb`
- Produces:
  - `getDb()` — 요청 간 공유되는 Drizzle 싱글턴
  - `apiError(code, message, status, details?)` → `Response`
  - `ApiErrorCode` 유니언 타입

- [ ] **Step 1: 앱 스캐폴딩**

`apps/web/package.json`:
```json
{
  "name": "@grossary/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@grossary/db": "workspace:*",
    "@grossary/engine": "workspace:*",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/web/next.config.ts`:
```ts
import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // 모노레포에서는 트레이싱 루트를 워크스페이스 최상단으로 올려야
  // standalone 번들에 packages/*가 포함된다.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@grossary/db", "@grossary/engine"],
};

export default config;
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*", "next-env.d.ts", ".next/types/**/*.ts"]
}
```

`apps/web/tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`apps/web/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/vitest.config.ts` — `@/` 별칭이 없으면 소스가 import하는 `@/lib/db`를 테스트가 해석하지 못한다:
```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
  },
});
```

`apps/web/tests/setup.ts` — 테스트가 개발 DB를 건드리지 못하게 강제한다:
```ts
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. 테스트는 개발 DB에 붙지 않습니다.");
}
process.env.DATABASE_URL = testUrl;
```

`getDb()`는 `DATABASE_URL`만 읽는다. 이 setup이 없으면 테스트가 조용히 개발 DB에 쓴다.

`apps/web/src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/web/src/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "용어집" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-8">용어집</main>;
}
```

- [ ] **Step 2: 에러 규약 테스트 작성**

`apps/web/tests/api-error.test.ts`:
```ts
import { expect, test } from "vitest";
import { apiError } from "../src/lib/api-error.js";

test("에러 응답이 규약 형태를 지킨다", async () => {
  const res = apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "term_not_found", message: "용어를 찾을 수 없습니다." },
  });
});

test("details가 있으면 함께 실린다", async () => {
  const res = apiError("validation_failed", "요청이 올바르지 않습니다.", 400, { field: "slug" });
  await expect(res.json()).resolves.toEqual({
    error: { code: "validation_failed", message: "요청이 올바르지 않습니다.", details: { field: "slug" } },
  });
});
```

- [ ] **Step 3: 테스트 실패 확인 후 구현**

Run: `pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/api-error.ts`:
```ts
export type ApiErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "term_not_found"
  | "slug_conflict"
  | "revision_conflict"
  | "payload_too_large"
  | "internal_error";

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  return Response.json({ error: details === undefined ? { code, message } : { code, message, details } }, { status });
}
```

`apps/web/src/lib/db.ts`:
```ts
import { createDb, type Db } from "@grossary/db";

let cached: Db | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = createDb(url);
  }
  return cached;
}
```

`apps/web/src/app/api/v1/health/route.ts`:
```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return apiError("internal_error", "데이터베이스에 연결할 수 없습니다.", 503);
  }
}
```

- [ ] **Step 4: 테스트와 개발 서버 확인**

```bash
pnpm --filter @grossary/web test
pnpm --filter @grossary/web dev &
curl -s localhost:3000/api/v1/health
```
Expected: 테스트 PASS, health가 `{"status":"ok"}` 반환.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: scaffold next.js app with api error contract and health endpoint"
```

---

### Task 6: 세션 인증과 로그인

**Files:**
- Create: `apps/web/src/lib/auth/password.ts`, `apps/web/src/lib/auth/session.ts`, `apps/web/src/lib/auth/current-user.ts`
- Create: `apps/web/src/app/api/v1/auth/login/route.ts`, `apps/web/src/app/api/v1/auth/logout/route.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/scripts/seed-admin.ts`
- Test: `apps/web/tests/password.test.ts`

**Interfaces:**
- Consumes: `users`, `sessions` from `@grossary/db`
- Produces:
  - `hashPassword(plain): Promise<string>`, `verifyPassword(plain, stored): Promise<boolean>`
  - `createSession(userId): Promise<{ id: string; expiresAt: Date }>`
  - `getCurrentUser(): Promise<{ id: string; email: string; name: string; role: "admin" | "editor" } | null>`

- [ ] **Step 1: 비밀번호 해시 테스트 작성**

`apps/web/tests/password.test.ts`:
```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.js";

test("올바른 비밀번호를 검증한다", async () => {
  const stored = await hashPassword("correct horse battery");
  await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
});

test("틀린 비밀번호를 거부한다", async () => {
  const stored = await hashPassword("correct horse battery");
  await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
});

test("같은 비밀번호도 매번 다른 해시를 만든다", async () => {
  const a = await hashPassword("same");
  const b = await hashPassword("same");
  expect(a).not.toBe(b);
});

test("손상된 저장값에서 예외 대신 false를 반환한다", async () => {
  await expect(verifyPassword("x", "garbage")).resolves.toBe(false);
});
```

- [ ] **Step 2: 실패 확인 후 구현**

Run: `pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/auth/password.ts`:
```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== KEY_LEN) return false;
    const derived = await scryptAsync(plain, Buffer.from(saltHex, "hex"), KEY_LEN);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
```

`apps/web/src/lib/auth/session.ts`:
```ts
import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { sessions } from "@grossary/db";
import { getDb } from "@/lib/db";

export const SESSION_COOKIE = "grossary_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await getDb().insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function deleteSession(id: string) {
  await getDb().delete(sessions).where(eq(sessions.id, id));
}

export async function purgeExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
```

`apps/web/src/lib/auth/current-user.ts`:
```ts
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { sessions, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE } from "./session";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 3: 로그인·로그아웃 라우트와 시드 스크립트 작성**

`apps/web/src/app/api/v1/auth/login/route.ts`:
```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, purgeExpiredSessions, SESSION_COOKIE } from "@/lib/auth/session";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  const [user] = await getDb().select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return apiError("unauthorized", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await purgeExpiredSessions();
  const session = await createSession(user.id);
  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session.id}; HttpOnly; SameSite=Lax; Path=/; Expires=${session.expiresAt.toUTCString()}`,
  );
  return res;
}
```

사용자가 없을 때도 있을 때와 같은 메시지와 상태 코드를 쓴다. 계정 존재 여부가 응답으로 새는 것을 막는다.

`apps/web/src/app/api/v1/auth/logout/route.ts`:
```ts
import { cookies } from "next/headers";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await deleteSession(id);

  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return res;
}
```

`apps/web/scripts/seed-admin.ts`:
```ts
import { createDb, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: tsx scripts/seed-admin.ts <email> <password> [name]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL!);
await db.insert(users).values({
  email,
  name: name ?? email,
  passwordHash: await hashPassword(password),
  role: "admin",
});
console.log(`admin created: ${email}`);
process.exit(0);
```

`apps/web/src/app/login/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });

    if (res.ok) {
      router.push("/terms");
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "로그인에 실패했습니다.");
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-6">
      <h1 className="mb-6 text-xl font-semibold">로그인</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input name="email" type="email" required placeholder="이메일"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <input name="password" type="password" required placeholder="비밀번호"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded bg-slate-900 px-3 py-2 text-white">
          로그인
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: 테스트와 수동 확인**

```bash
pnpm --filter @grossary/web test
pnpm --filter @grossary/web exec tsx scripts/seed-admin.ts admin@example.com pw-for-local Admin
curl -s -X POST localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"pw-for-local"}' -i | head -20
```
Expected: password 테스트 4개 PASS. 로그인 응답 200과 `set-cookie` 헤더 확인. 잘못된 비밀번호로는 401.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add session auth with scrypt password hashing"
```

---

### Task 7: API Key 발급과 검증

**Files:**
- Create: `apps/web/src/lib/auth/api-key.ts`, `apps/web/src/lib/auth/require.ts`
- Create: `apps/web/src/app/api/v1/keys/route.ts`
- Create: `apps/web/src/app/settings/api-keys/page.tsx`
- Test: `apps/web/tests/api-key.test.ts`

**Interfaces:**
- Consumes: `apiKeys` from `@grossary/db`, `getCurrentUser`
- Produces:
  - `generateApiKey(): { token: string; prefix: string; hash: string }`
  - `hashApiKey(token: string): string`
  - `type Scope = "read" | "write" | "validate"`
  - `requireAuth(request: Request, scope: Scope): Promise<{ kind: "user"; user: CurrentUser } | { kind: "key"; keyId: string } | Response>`

- [ ] **Step 1: 키 생성·해시 테스트 작성**

`apps/web/tests/api-key.test.ts`:
```ts
import { expect, test } from "vitest";
import { generateApiKey, hashApiKey } from "../src/lib/auth/api-key.js";

test("발급된 토큰이 규약 형식을 따른다", () => {
  const { token, prefix } = generateApiKey();
  expect(token.startsWith(`glk_${prefix}_`)).toBe(true);
  expect(prefix).toHaveLength(8);
});

test("토큰 해시가 재현 가능하다", () => {
  const { token, hash } = generateApiKey();
  expect(hashApiKey(token)).toBe(hash);
});

test("매 발급마다 서로 다른 토큰이 나온다", () => {
  expect(generateApiKey().token).not.toBe(generateApiKey().token);
});
```

- [ ] **Step 2: 실패 확인 후 구현**

Run: `pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/auth/api-key.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";

export type Scope = "read" | "write" | "validate";

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `glk_${prefix}_${secret}`;
  return { token, prefix, hash: hashApiKey(token) };
}

export function parseApiKey(token: string): { prefix: string } | null {
  const parts = token.split("_");
  if (parts.length !== 3 || parts[0] !== "glk" || !parts[1] || !parts[2]) return null;
  return { prefix: parts[1] };
}
```

`apps/web/src/lib/auth/require.ts`:
```ts
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { apiKeys } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { hashApiKey, parseApiKey, type Scope } from "./api-key";

export type AuthResult =
  | { kind: "user"; user: CurrentUser }
  | { kind: "key"; keyId: string };

export async function requireAuth(request: Request, scope: Scope): Promise<AuthResult | Response> {
  const header = request.headers.get("authorization");

  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const parsed = parseApiKey(token);
    if (!parsed) return apiError("unauthorized", "API 키 형식이 올바르지 않습니다.", 401);

    const [key] = await getDb()
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.prefix, parsed.prefix),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1);

    if (!key || key.keyHash !== hashApiKey(token)) {
      return apiError("unauthorized", "API 키가 유효하지 않습니다.", 401);
    }
    if (!key.scopes.includes(scope)) {
      return apiError("forbidden", `이 키에는 ${scope} 권한이 없습니다.`, 403);
    }

    await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
    return { kind: "key", keyId: key.id };
  }

  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);
  return { kind: "user", user };
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
```

`apps/web/src/app/api/v1/keys/route.ts`:
```ts
import { desc } from "drizzle-orm";
import { z } from "zod";
import { apiKeys } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { generateApiKey } from "@/lib/auth/api-key";

const createSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(["read", "write", "validate"])).min(1),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);

  const rows = await getDb()
    .select({
      id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix,
      scopes: apiKeys.scopes, createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return Response.json({ keys: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "키 이름과 scope가 필요합니다.", 400, parsed.error.flatten());
  }

  const { token, prefix, hash } = generateApiKey();
  const [row] = await getDb()
    .insert(apiKeys)
    .values({ name: parsed.data.name, prefix, keyHash: hash, scopes: parsed.data.scopes, createdBy: user.id })
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes });

  return Response.json({ key: row, token }, { status: 201 });
}
```

평문 토큰은 이 응답에서만 나온다. 이후로는 해시만 남으므로 복구할 수 없다.

- [ ] **Step 3: API 키 관리 화면 작성**

`apps/web/src/app/settings/api-keys/page.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";

interface KeyRow {
  id: string; name: string; prefix: string; scopes: string[];
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}

const ALL_SCOPES = ["read", "write", "validate"] as const;

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [issued, setIssued] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/keys");
    if (res.ok) setKeys((await res.json()).keys);
  }

  useEffect(() => {
    void load();
  }, []);

  async function issue() {
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) return;

    setIssued((await res.json()).token);
    setName("");
    void load();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold">API 키</h1>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="용도 (예: ai-lint)"
          className="flex-1 rounded border border-slate-300 px-3 py-2" />
        {ALL_SCOPES.map((sc) => (
          <label key={sc} className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={scopes.includes(sc)}
              onChange={(e) =>
                setScopes(e.target.checked ? [...scopes, sc] : scopes.filter((v) => v !== sc))
              } />
            {sc}
          </label>
        ))}
        <button onClick={issue} disabled={!name || scopes.length === 0}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          발급
        </button>
      </div>

      {issued && (
        <div className="mb-6 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="mb-1 font-medium text-emerald-900">지금 복사하세요. 다시 볼 수 없습니다.</p>
          <code className="block break-all rounded bg-white px-2 py-1">{issued}</code>
        </div>
      )}

      <ul className="divide-y divide-slate-200">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-3 text-sm">
            <span className="font-medium">{k.name}</span>
            <span className="text-slate-500">glk_{k.prefix}_… · {k.scopes.join(", ")}</span>
            <span className="text-slate-400">
              {k.lastUsedAt ? `최근 사용 ${k.lastUsedAt.slice(0, 10)}` : "미사용"}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

발급 직후 한 번만 평문 토큰을 보여준다. 목록에는 prefix만 남아서 어떤 키인지 식별만 된다.

- [ ] **Step 4: 테스트 실행**

Run: `pnpm --filter @grossary/web test`
Expected: api-key 테스트 3개 PASS.

- [ ] **Step 5: 키 발급과 인증 수동 확인**

```bash
curl -s -X POST localhost:3000/api/v1/keys -b cookies.txt \
  -H 'content-type: application/json' -d '{"name":"ai-lint","scopes":["read","validate"]}'
curl -s localhost:3000/api/v1/health -H "Authorization: Bearer <발급된 토큰>"
```
Expected: 201과 토큰 반환. scope 없는 엔드포인트 호출 시 403.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: add api key issuance and scoped auth"
```

---

### Task 8: 용어 생성 API + 중복 경고 + 리비전

**Files:**
- Create: `apps/web/src/lib/terms/schema.ts`, `apps/web/src/lib/terms/slug.ts`, `apps/web/src/lib/terms/create.ts`
- Create: `apps/web/src/app/api/v1/terms/route.ts`
- Test: `apps/web/tests/slug.test.ts`, `apps/web/tests/terms-create.test.ts`

**Interfaces:**
- Consumes: `terms`, `termSurfaces`, `termRevisions`, `surfaceKeys` from `@grossary/db`; `requireAuth`
- Produces:
  - `slugify(input: string): string`
  - `termInputSchema` (zod) — `{ termType, nameEn?, nameKo?, fullNameEn?, fullNameKo?, domain[], status, definitionMd?, surfaces[], force? }`
  - `createTerm(input, authorId): Promise<{ term; warnings: DuplicateWarning[] }>`
  - `interface DuplicateWarning { normLoose: string; conflictingTermId: string; conflictingSlug: string; surfaceText: string }`

- [ ] **Step 1: slug 테스트 작성**

`apps/web/tests/slug.test.ts`:
```ts
import { expect, test } from "vitest";
import { slugify } from "../src/lib/terms/slug.js";

test("영문 표기를 하이픈 슬러그로 만든다", () => {
  expect(slugify("Auto Exposure")).toBe("auto-exposure");
  expect(slugify("MIPI Rx")).toBe("mipi-rx");
});

test("한글은 그대로 두고 공백만 하이픈으로 바꾼다", () => {
  expect(slugify("이미지 센서")).toBe("이미지-센서");
});

test("연속 구분자를 하나로 접고 양끝을 정리한다", () => {
  expect(slugify("  Auto -- Exposure  ")).toBe("auto-exposure");
});

test("슬러그로 만들 수 없는 입력에는 빈 문자열을 반환한다", () => {
  expect(slugify("!!!")).toBe("");
});
```

- [ ] **Step 2: 생성 로직 테스트 작성**

`apps/web/tests/terms-create.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { createDb, terms, termRevisions, termSurfaces } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
});

test("표준 표기가 canonical surface로 함께 저장된다", async () => {
  const { term } = await createTerm(
    { termType: "abbreviation", nameEn: "AE", fullNameEn: "Auto Exposure", nameKo: "자동노출",
      domain: ["ISP"], status: "approved", surfaces: [] },
    null,
  );
  created.push(term.id);

  const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
  const texts = surfaces.map((s) => s.text).sort();
  expect(texts).toEqual(["AE", "Auto Exposure", "자동노출"]);
  expect(surfaces.find((s) => s.text === "Auto Exposure")?.kind).toBe("full_name");
});

test("같은 정규화 키를 가진 기존 용어가 있으면 경고를 반환하되 저장은 한다", async () => {
  const first = await createTerm(
    { termType: "term", nameEn: "Auto Exposure", domain: ["ISP"], status: "approved", surfaces: [] },
    null,
  );
  created.push(first.term.id);

  const second = await createTerm(
    { termType: "term", nameEn: "auto-exposure", domain: ["PM"], status: "draft", surfaces: [] },
    null,
  );
  created.push(second.term.id);

  expect(second.warnings).toHaveLength(1);
  expect(second.warnings[0]!.conflictingTermId).toBe(first.term.id);
  expect(second.term.id).toBeDefined();
});

test("생성 시 1번 리비전이 기록된다", async () => {
  const { term } = await createTerm(
    { termType: "term", nameEn: "Black Level", domain: ["ISP"], status: "draft", surfaces: [] },
    null,
  );
  created.push(term.id);

  const revs = await db.select().from(termRevisions).where(eq(termRevisions.termId, term.id));
  expect(revs).toHaveLength(1);
  expect(revs[0]!.revisionNumber).toBe(1);
});

test("슬러그가 겹치면 접미사를 붙여 고유하게 만든다", async () => {
  const a = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "draft", surfaces: [] }, null);
  const b = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "draft", surfaces: [] }, null);
  created.push(a.term.id, b.term.id);

  expect(a.term.slug).toBe("gain");
  expect(b.term.slug).toBe("gain-2");
});
```

- [ ] **Step 3: 실패 확인 후 구현**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/terms/slug.ts`:
```ts
export function slugify(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
```

`apps/web/src/lib/terms/schema.ts`:
```ts
import { z } from "zod";

export const surfaceInputSchema = z.object({
  text: z.string().min(1),
  lang: z.enum(["en", "ko", "neutral"]).default("neutral"),
  kind: z.enum(["canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden"]),
  caseSensitive: z.boolean().optional(),
});

export const termInputBaseSchema = z.object({
  termType: z.enum(["term", "abbreviation", "project", "product_id", "code", "unit"]).default("term"),
  nameEn: z.string().min(1).optional(),
  nameKo: z.string().min(1).optional(),
  fullNameEn: z.string().min(1).optional(),
  fullNameKo: z.string().min(1).optional(),
  domain: z.array(z.string().min(1)).default([]),
  status: z.enum(["draft", "approved", "deprecated", "forbidden"]).default("draft"),
  definitionMd: z.string().optional(),
  surfaces: z.array(surfaceInputSchema).default([]),
  force: z.boolean().optional(),
});

/** 생성용. 표준 표기가 최소 하나는 있어야 한다. */
export const termInputSchema = termInputBaseSchema.refine(
  (v) => Boolean(v.nameEn ?? v.nameKo),
  { message: "nameEn 또는 nameKo 중 최소 하나가 필요합니다.", path: ["nameEn"] },
);

/**
 * 수정용. 부분 갱신이라 표준 표기 필수 조건을 걸지 않는다.
 * termInputSchema는 .refine()이 붙은 ZodEffects라서 .partial()을 부를 수 없다.
 * base를 따로 두고 여기서 파생시키는 이유가 이것이다.
 */
export const termPatchSchema = termInputBaseSchema.partial().extend({
  expectedRevision: z.number().int().positive().optional(),
});

export type TermInput = z.infer<typeof termInputBaseSchema>;
export type SurfaceInput = z.infer<typeof surfaceInputSchema>;
```

`apps/web/src/lib/terms/create.ts`:
```ts
import { eq, inArray, like } from "drizzle-orm";
import { surfaceKeys, terms, termRevisions, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";
import { slugify } from "./slug";
import type { SurfaceInput, TermInput } from "./schema";

export interface DuplicateWarning {
  normLoose: string;
  surfaceText: string;
  conflictingTermId: string;
  conflictingSlug: string;
}

/** 짧은 전대문자 표기는 대소문자를 구분해야 노이즈가 생기지 않는다. */
function defaultCaseSensitive(text: string): boolean {
  return /^[A-Z0-9]{2,6}$/.test(text);
}

function collectSurfaces(input: TermInput): SurfaceInput[] {
  const derived: SurfaceInput[] = [];
  const isAbbrev = input.termType === "abbreviation";

  if (input.nameEn) derived.push({ text: input.nameEn, lang: "en", kind: isAbbrev ? "abbreviation" : "canonical" });
  if (input.nameKo) derived.push({ text: input.nameKo, lang: "ko", kind: "canonical" });
  if (input.fullNameEn) derived.push({ text: input.fullNameEn, lang: "en", kind: "full_name" });
  if (input.fullNameKo) derived.push({ text: input.fullNameKo, lang: "ko", kind: "full_name" });

  const merged = [...derived, ...input.surfaces];
  const seen = new Set<string>();
  return merged.filter((s) => {
    const key = `${surfaceKeys(s.text).normLoose}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function uniqueSlug(base: string): Promise<string> {
  const seed = base || "term";
  const existing = await getDb()
    .select({ slug: terms.slug })
    .from(terms)
    .where(like(terms.slug, `${seed}%`));

  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(seed)) return seed;

  for (let n = 2; ; n += 1) {
    const candidate = `${seed}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function findDuplicates(surfaces: SurfaceInput[]): Promise<DuplicateWarning[]> {
  const keys = surfaces.map((s) => surfaceKeys(s.text).normLoose).filter(Boolean);
  if (keys.length === 0) return [];

  const rows = await getDb()
    .select({
      normLoose: termSurfaces.normLoose,
      text: termSurfaces.text,
      termId: termSurfaces.termId,
      slug: terms.slug,
    })
    .from(termSurfaces)
    .innerJoin(terms, eq(terms.id, termSurfaces.termId))
    .where(inArray(termSurfaces.normLoose, keys));

  return rows.map((r) => ({
    normLoose: r.normLoose,
    surfaceText: r.text,
    conflictingTermId: r.termId,
    conflictingSlug: r.slug,
  }));
}

export async function createTerm(input: TermInput, authorId: string | null) {
  const db = getDb();
  const surfaces = collectSurfaces(input);
  const warnings = await findDuplicates(surfaces);
  const slug = await uniqueSlug(slugify(input.nameEn ?? input.nameKo ?? ""));

  const [term] = await db
    .insert(terms)
    .values({
      slug,
      termType: input.termType,
      nameEn: input.nameEn ?? null,
      nameKo: input.nameKo ?? null,
      fullNameEn: input.fullNameEn ?? null,
      fullNameKo: input.fullNameKo ?? null,
      domain: input.domain,
      status: input.status,
      definitionMd: input.definitionMd ?? null,
      createdBy: authorId,
      updatedBy: authorId,
    })
    .returning();

  const savedSurfaces = surfaces.length
    ? await db
        .insert(termSurfaces)
        .values(
          surfaces.map((s) => ({
            termId: term!.id,
            text: s.text,
            lang: s.lang,
            kind: s.kind,
            caseSensitive: s.caseSensitive ?? defaultCaseSensitive(s.text),
            ...surfaceKeys(s.text),
          })),
        )
        .returning()
    : [];

  await db.insert(termRevisions).values({
    termId: term!.id,
    revisionNumber: 1,
    snapshot: { term, surfaces: savedSurfaces },
    message: "created",
    authorId,
  });

  return { term: term!, surfaces: savedSurfaces, warnings };
}
```

- [ ] **Step 4: 라우트 연결 후 테스트 통과 확인**

`apps/web/src/app/api/v1/terms/route.ts`:
```ts
import { apiError } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { termInputSchema } from "@/lib/terms/schema";
import { createTerm } from "@/lib/terms/create";

export async function POST(request: Request) {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const parsed = termInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "용어 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
  }

  const authorId = auth.kind === "user" ? auth.user.id : null;
  const { term, surfaces, warnings } = await createTerm(parsed.data, authorId);

  return Response.json({ term, surfaces, warnings }, { status: 201 });
}
```

중복이 있어도 409를 던지지 않는다. 동음이의어를 허용하기로 했으므로 저장은 진행하고 `warnings`로만 알린다.

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: slug 4개 + create 4개 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add term creation with duplicate warnings and revision tracking"
```

---

### Task 9: 용어 조회·검색 API

**Files:**
- Create: `apps/web/src/lib/terms/query.ts`
- Create: `apps/web/src/app/api/v1/terms/[idOrSlug]/route.ts`
- Modify: `apps/web/src/app/api/v1/terms/route.ts` (GET 추가)
- Test: `apps/web/tests/terms-query.test.ts`

**Interfaces:**
- Consumes: Task 8의 `createTerm`, `terms`/`termSurfaces` 테이블
- Produces:
  - `getTermByIdOrSlug(idOrSlug): Promise<TermDetail | null>`
  - `listTerms(params): Promise<{ items: TermSummary[]; total: number }>` — `params`는 `{ q?, termType?, domain?, status?, page, pageSize }`
  - `TermSummary = { id, slug, termType, nameEn, nameKo, domain, status }`
  - `TermDetail = TermSummary & { fullNameEn, fullNameKo, definitionMd, bodyMd, surfaces, homonyms }`

- [ ] **Step 1: 조회 테스트 작성**

`apps/web/tests/terms-query.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { getTermByIdOrSlug, listTerms } from "../src/lib/terms/query.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];

beforeAll(async () => {
  const ae = await createTerm(
    { termType: "abbreviation", nameEn: "AE", fullNameEn: "Auto Exposure", nameKo: "자동노출",
      domain: ["ISP"], status: "approved",
      surfaces: [{ text: "오토익스포저", lang: "ko", kind: "discouraged" }] },
    null,
  );
  const hw = await createTerm(
    { termType: "term", nameEn: "AE", fullNameEn: "Application Engineer",
      domain: ["PM"], status: "approved", surfaces: [] },
    null,
  );
  ids.push(ae.term.id, hw.term.id);
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("슬러그로 상세를 조회한다", async () => {
  const detail = await getTermByIdOrSlug("ae");
  expect(detail?.nameEn).toBe("AE");
  expect(detail?.surfaces.length).toBeGreaterThanOrEqual(3);
});

test("동음이의어를 상세에 함께 싣는다", async () => {
  const detail = await getTermByIdOrSlug("ae");
  expect(detail?.homonyms.map((h) => h.id)).toContain(ids[1]);
});

test("비권장 표기로 검색해도 해당 용어가 나온다", async () => {
  const { items } = await listTerms({ q: "오토익스포저", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
});

test("표기 변형으로 검색해도 찾는다", async () => {
  const { items } = await listTerms({ q: "auto-exposure", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
});

test("domain으로 필터링한다", async () => {
  const { items } = await listTerms({ domain: "PM", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[1]);
  expect(items.map((t) => t.id)).not.toContain(ids[0]);
});

test("없는 슬러그는 null을 반환한다", async () => {
  await expect(getTermByIdOrSlug("does-not-exist")).resolves.toBeNull();
});
```

- [ ] **Step 2: 실패 확인 후 구현**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/terms/query.ts`:
```ts
import { and, arrayContains, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";

export interface TermSummary {
  id: string; slug: string; termType: string;
  nameEn: string | null; nameKo: string | null;
  domain: string[]; status: string;
}

export interface SurfaceRow {
  id: string; text: string; lang: string; kind: string; caseSensitive: boolean;
}

export interface TermDetail extends TermSummary {
  fullNameEn: string | null; fullNameKo: string | null;
  definitionMd: string | null; bodyMd: string | null;
  surfaces: SurfaceRow[];
  homonyms: TermSummary[];
}

const summaryColumns = {
  id: terms.id, slug: terms.slug, termType: terms.termType,
  nameEn: terms.nameEn, nameKo: terms.nameKo, domain: terms.domain, status: terms.status,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getTermByIdOrSlug(idOrSlug: string): Promise<TermDetail | null> {
  const db = getDb();
  const [term] = await db
    .select()
    .from(terms)
    .where(UUID_RE.test(idOrSlug) ? eq(terms.id, idOrSlug) : eq(terms.slug, idOrSlug))
    .limit(1);

  if (!term) return null;

  const surfaces = await db
    .select({
      id: termSurfaces.id, text: termSurfaces.text, lang: termSurfaces.lang,
      kind: termSurfaces.kind, caseSensitive: termSurfaces.caseSensitive,
      normLoose: termSurfaces.normLoose,
    })
    .from(termSurfaces)
    .where(eq(termSurfaces.termId, term.id));

  const keys = [...new Set(surfaces.map((s) => s.normLoose))];
  const homonyms = keys.length
    ? await db
        .selectDistinctOn([terms.id], summaryColumns)
        .from(terms)
        .innerJoin(termSurfaces, eq(termSurfaces.termId, terms.id))
        .where(and(inArray(termSurfaces.normLoose, keys), ne(terms.id, term.id)))
        .orderBy(terms.id)
    : [];

  return {
    ...term,
    surfaces: surfaces.map(({ normLoose: _ignored, ...rest }) => rest),
    homonyms,
  };
}

export interface ListParams {
  q?: string; termType?: string; domain?: string; status?: string;
  page: number; pageSize: number;
}

export async function listTerms(params: ListParams): Promise<{ items: TermSummary[]; total: number }> {
  const db = getDb();
  const filters = [];

  if (params.termType) filters.push(eq(terms.termType, params.termType as never));
  if (params.status) filters.push(eq(terms.status, params.status as never));
  if (params.domain) filters.push(arrayContains(terms.domain, [params.domain]));

  if (params.q) {
    const { normLoose, normSpace } = surfaceKeys(params.q);
    const matching = db
      .select({ termId: termSurfaces.termId })
      .from(termSurfaces)
      .where(
        or(
          eq(termSurfaces.normLoose, normLoose),
          eq(termSurfaces.normSpace, normSpace),
          sql`${termSurfaces.normLoose} % ${normLoose}`,
        ),
      );
    filters.push(inArray(terms.id, matching));
  }

  const where = filters.length ? and(...filters) : undefined;

  const [items, [counted]] = await Promise.all([
    db
      .select(summaryColumns)
      .from(terms)
      .where(where)
      .orderBy(desc(terms.updatedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(terms).where(where),
  ]);

  return { items, total: counted?.total ?? 0 };
}
```

`sql\`... % ...\`` 는 pg_trgm의 유사도 연산자다. 정확 일치가 없을 때 오타를 흡수한다. `pg_trgm` 확장은 Task 3에서 이미 활성화했다.

- [ ] **Step 3: 라우트 작성**

`apps/web/src/app/api/v1/terms/[idOrSlug]/route.ts`:
```ts
import { apiError } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";

export async function GET(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const { idOrSlug } = await ctx.params;
  const term = await getTermByIdOrSlug(idOrSlug);
  if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

  return Response.json({ term });
}
```

`apps/web/src/app/api/v1/terms/route.ts`에 GET 추가 (기존 POST는 유지):
```ts
import { listTerms } from "@/lib/terms/query";

export async function GET(request: Request) {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  const result = await listTerms({
    q: url.searchParams.get("q") ?? undefined,
    termType: url.searchParams.get("type") ?? undefined,
    domain: url.searchParams.get("domain") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page,
    pageSize,
  });

  return Response.json({ ...result, page, pageSize });
}
```

- [ ] **Step 4: 테스트 실행**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: query 테스트 6개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add term detail and surface-based list search"
```

---

### Task 10: 용어 수정·삭제 + 리비전 이력 API

**Files:**
- Create: `apps/web/src/lib/terms/update.ts`
- Create: `apps/web/src/app/api/v1/terms/[idOrSlug]/revisions/route.ts`
- Modify: `apps/web/src/app/api/v1/terms/[idOrSlug]/route.ts` (PATCH, DELETE 추가)
- Test: `apps/web/tests/terms-update.test.ts`

**Interfaces:**
- Consumes: Task 8의 `createTerm`, `collectSurfaces` 규칙; Task 9의 `getTermByIdOrSlug`
- Produces:
  - `updateTerm(termId, input, authorId, expectedRevision?): Promise<{ term; surfaces; warnings } | { conflict: true; currentRevision: number }>`
  - `listRevisions(termId): Promise<RevisionRow[]>`
  - `deleteTerm(termId): Promise<boolean>`

- [ ] **Step 1: 수정·충돌 테스트 작성**

`apps/web/tests/terms-update.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { createDb, terms } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { deleteTerm, listRevisions, updateTerm } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
});

async function seed() {
  const { term } = await createTerm(
    { termType: "term", nameEn: "Black Level", domain: ["ISP"], status: "draft", surfaces: [] },
    null,
  );
  created.push(term.id);
  return term;
}

test("수정하면 리비전이 하나 늘어난다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "블랙레벨", status: "approved" }, null);

  const revs = await listRevisions(term.id);
  expect(revs.map((r) => r.revisionNumber)).toEqual([2, 1]);
});

test("표기를 교체하면 이전 표기가 사라진다", async () => {
  const term = await seed();
  const result = await updateTerm(
    term.id,
    { surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] },
    null,
  );
  if ("conflict" in result) throw new Error("unexpected conflict");

  expect(result.surfaces.map((s) => s.text).sort()).toEqual(["BLC", "Black Level"]);
});

test("기대 리비전이 어긋나면 충돌을 반환하고 저장하지 않는다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "블랙레벨" }, null);

  const stale = await updateTerm(term.id, { nameKo: "다른값" }, null, 1);
  expect(stale).toEqual({ conflict: true, currentRevision: 2 });

  const revs = await listRevisions(term.id);
  expect(revs).toHaveLength(2);
});

test("삭제하면 리비전도 함께 사라진다", async () => {
  const term = await seed();
  await expect(deleteTerm(term.id)).resolves.toBe(true);
  await expect(listRevisions(term.id)).resolves.toEqual([]);
  created.length = 0;
});
```

- [ ] **Step 2: 실패 확인 후 구현**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/terms/update.ts`:
```ts
import { desc, eq, sql } from "drizzle-orm";
import { surfaceKeys, terms, termRevisions, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";
import { findDuplicates, type DuplicateWarning } from "./create";
import type { SurfaceInput, TermInput } from "./schema";

export type TermUpdate = Partial<Omit<TermInput, "force">>;

export interface RevisionRow {
  id: string; revisionNumber: number; message: string | null;
  authorId: string | null; createdAt: Date;
}

function defaultCaseSensitive(text: string): boolean {
  return /^[A-Z0-9]{2,6}$/.test(text);
}

function derivedSurfaces(row: typeof terms.$inferSelect, explicit: SurfaceInput[]): SurfaceInput[] {
  const derived: SurfaceInput[] = [];
  const isAbbrev = row.termType === "abbreviation";

  if (row.nameEn) derived.push({ text: row.nameEn, lang: "en", kind: isAbbrev ? "abbreviation" : "canonical" });
  if (row.nameKo) derived.push({ text: row.nameKo, lang: "ko", kind: "canonical" });
  if (row.fullNameEn) derived.push({ text: row.fullNameEn, lang: "en", kind: "full_name" });
  if (row.fullNameKo) derived.push({ text: row.fullNameKo, lang: "ko", kind: "full_name" });

  const seen = new Set<string>();
  return [...derived, ...explicit].filter((s) => {
    const key = `${surfaceKeys(s.text).normLoose}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listRevisions(termId: string): Promise<RevisionRow[]> {
  return getDb()
    .select({
      id: termRevisions.id, revisionNumber: termRevisions.revisionNumber,
      message: termRevisions.message, authorId: termRevisions.authorId,
      createdAt: termRevisions.createdAt,
    })
    .from(termRevisions)
    .where(eq(termRevisions.termId, termId))
    .orderBy(desc(termRevisions.revisionNumber));
}

export async function deleteTerm(termId: string): Promise<boolean> {
  const deleted = await getDb().delete(terms).where(eq(terms.id, termId)).returning({ id: terms.id });
  return deleted.length > 0;
}

export async function updateTerm(
  termId: string,
  input: TermUpdate,
  authorId: string | null,
  expectedRevision?: number,
): Promise<{ term: typeof terms.$inferSelect; surfaces: (typeof termSurfaces.$inferSelect)[]; warnings: DuplicateWarning[] } | { conflict: true; currentRevision: number }> {
  const db = getDb();

  const [latest] = await db
    .select({ n: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
    .from(termRevisions)
    .where(eq(termRevisions.termId, termId));

  const currentRevision = latest?.n ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    return { conflict: true, currentRevision };
  }

  const [updated] = await db
    .update(terms)
    .set({
      ...(input.termType !== undefined ? { termType: input.termType } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.nameKo !== undefined ? { nameKo: input.nameKo } : {}),
      ...(input.fullNameEn !== undefined ? { fullNameEn: input.fullNameEn } : {}),
      ...(input.fullNameKo !== undefined ? { fullNameKo: input.fullNameKo } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.definitionMd !== undefined ? { definitionMd: input.definitionMd } : {}),
      updatedBy: authorId,
      updatedAt: new Date(),
    })
    .where(eq(terms.id, termId))
    .returning();

  if (!updated) return { conflict: true, currentRevision };

  const explicit = input.surfaces ?? [];
  const nextSurfaces = derivedSurfaces(updated, explicit);
  const warnings = await findDuplicates(explicit);

  await db.delete(termSurfaces).where(eq(termSurfaces.termId, termId));
  const savedSurfaces = nextSurfaces.length
    ? await db
        .insert(termSurfaces)
        .values(
          nextSurfaces.map((s) => ({
            termId,
            text: s.text,
            lang: s.lang,
            kind: s.kind,
            caseSensitive: s.caseSensitive ?? defaultCaseSensitive(s.text),
            ...surfaceKeys(s.text),
          })),
        )
        .returning()
    : [];

  await db.insert(termRevisions).values({
    termId,
    revisionNumber: currentRevision + 1,
    snapshot: { term: updated, surfaces: savedSurfaces },
    message: "updated",
    authorId,
  });

  return { term: updated, surfaces: savedSurfaces, warnings };
}
```

표기를 통째로 지우고 다시 넣는다. 부분 갱신보다 단순하고, 리비전 스냅샷이 항상 완전한 상태를 담게 된다.

- [ ] **Step 3: 라우트 추가**

`apps/web/src/app/api/v1/terms/[idOrSlug]/route.ts`에 추가:
```ts
import { termPatchSchema } from "@/lib/terms/schema";
import { deleteTerm, updateTerm } from "@/lib/terms/update";

export async function PATCH(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const { idOrSlug } = await ctx.params;
  const existing = await getTermByIdOrSlug(idOrSlug);
  if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

  const parsed = termPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "수정 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
  }

  const { expectedRevision, ...input } = parsed.data;
  const authorId = auth.kind === "user" ? auth.user.id : null;
  const result = await updateTerm(existing.id, input, authorId, expectedRevision);

  if ("conflict" in result) {
    return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, {
      currentRevision: result.currentRevision,
    });
  }
  return Response.json(result);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user" || auth.user.role !== "admin") {
    return apiError("forbidden", "삭제는 관리자만 할 수 있습니다.", 403);
  }

  const { idOrSlug } = await ctx.params;
  const existing = await getTermByIdOrSlug(idOrSlug);
  if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

  await deleteTerm(existing.id);
  return new Response(null, { status: 204 });
}
```

`apps/web/src/app/api/v1/terms/[idOrSlug]/revisions/route.ts`:
```ts
import { apiError } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listRevisions } from "@/lib/terms/update";

export async function GET(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const { idOrSlug } = await ctx.params;
  const term = await getTermByIdOrSlug(idOrSlug);
  if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

  return Response.json({ revisions: await listRevisions(term.id) });
}
```

- [ ] **Step 4: 테스트 실행**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: update 테스트 4개 PASS, 기존 테스트 전부 유지.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add term update with optimistic locking and revision history"
```

---

### Task 11: 배치 용어 조회 API (`/terms/lookup`)

AI-Lint가 M2 이전에도 바로 쓸 수 있는 엔드포인트다.

**Files:**
- Create: `apps/web/src/lib/terms/lookup.ts`
- Create: `apps/web/src/app/api/v1/terms/lookup/route.ts`
- Test: `apps/web/tests/terms-lookup.test.ts`

**Interfaces:**
- Consumes: `surfaceKeys`, `terms`, `termSurfaces`
- Produces:
  - `lookupTerms(texts: string[]): Promise<LookupResult[]>`
  - `interface LookupResult { text: string; found: boolean; matchKind: string | null; terms: TermSummary[]; similar: { slug: string; score: number }[] }`

- [ ] **Step 1: 테스트 작성**

`apps/web/tests/terms-lookup.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { lookupTerms } from "../src/lib/terms/lookup.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];

beforeAll(async () => {
  const ae = await createTerm(
    { termType: "abbreviation", nameEn: "AE", fullNameEn: "Auto Exposure", nameKo: "자동노출",
      domain: ["ISP"], status: "approved", surfaces: [] },
    null,
  );
  ids.push(ae.term.id);
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("등록된 표기를 찾는다", async () => {
  const [ae] = await lookupTerms(["AE"]);
  expect(ae!.found).toBe(true);
  expect(ae!.matchKind).toBe("abbreviation");
  expect(ae!.terms[0]!.nameEn).toBe("AE");
});

test("표기 변형도 같은 용어로 해석한다", async () => {
  const [variant] = await lookupTerms(["AutoExposure"]);
  expect(variant!.found).toBe(true);
  expect(variant!.terms[0]!.id).toBe(ids[0]);
});

test("미등록 표기는 found=false로 반환한다", async () => {
  const [missing] = await lookupTerms(["Nonexistent Widget"]);
  expect(missing!.found).toBe(false);
  expect(missing!.terms).toEqual([]);
});

test("요청 순서와 개수를 그대로 보존한다", async () => {
  const results = await lookupTerms(["AE", "Nonexistent Widget", "자동노출"]);
  expect(results.map((r) => r.text)).toEqual(["AE", "Nonexistent Widget", "자동노출"]);
});

test("중복 입력도 각각 결과를 돌려준다", async () => {
  const results = await lookupTerms(["AE", "AE"]);
  expect(results).toHaveLength(2);
  expect(results.every((r) => r.found)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인 후 구현**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/terms/lookup.ts`:
```ts
import { eq, inArray, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";
import type { TermSummary } from "./query";

export interface LookupResult {
  text: string;
  found: boolean;
  matchKind: string | null;
  terms: TermSummary[];
  similar: { slug: string; score: number }[];
}

export async function lookupTerms(texts: string[]): Promise<LookupResult[]> {
  const db = getDb();
  const keys = texts.map((t) => surfaceKeys(t).normLoose);
  const unique = [...new Set(keys.filter(Boolean))];

  const rows = unique.length
    ? await db
        .select({
          normLoose: termSurfaces.normLoose, kind: termSurfaces.kind,
          id: terms.id, slug: terms.slug, termType: terms.termType,
          nameEn: terms.nameEn, nameKo: terms.nameKo,
          domain: terms.domain, status: terms.status,
        })
        .from(termSurfaces)
        .innerJoin(terms, eq(terms.id, termSurfaces.termId))
        .where(inArray(termSurfaces.normLoose, unique))
    : [];

  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byKey.get(row.normLoose) ?? [];
    bucket.push(row);
    byKey.set(row.normLoose, bucket);
  }

  const missing = unique.filter((k) => !byKey.has(k));
  const similarByKey = new Map<string, { slug: string; score: number }[]>();

  for (const key of missing) {
    const suggestions = await db
      .select({ slug: terms.slug, score: sql<number>`similarity(${termSurfaces.normLoose}, ${key})` })
      .from(termSurfaces)
      .innerJoin(terms, eq(terms.id, termSurfaces.termId))
      .where(sql`${termSurfaces.normLoose} % ${key}`)
      .orderBy(sql`similarity(${termSurfaces.normLoose}, ${key}) desc`)
      .limit(3);
    similarByKey.set(key, suggestions);
  }

  return texts.map((text, index) => {
    const key = keys[index]!;
    const matches = byKey.get(key) ?? [];
    const seen = new Set<string>();
    const matchedTerms: TermSummary[] = [];

    for (const m of matches) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      matchedTerms.push({
        id: m.id, slug: m.slug, termType: m.termType,
        nameEn: m.nameEn, nameKo: m.nameKo, domain: m.domain, status: m.status,
      });
    }

    return {
      text,
      found: matchedTerms.length > 0,
      matchKind: matches[0]?.kind ?? null,
      terms: matchedTerms,
      similar: matchedTerms.length > 0 ? [] : (similarByKey.get(key) ?? []),
    };
  });
}
```

- [ ] **Step 3: 라우트 작성**

`apps/web/src/app/api/v1/terms/lookup/route.ts`:
```ts
import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { lookupTerms } from "@/lib/terms/lookup";

const bodySchema = z.object({ texts: z.array(z.string().min(1)).min(1).max(500) });

export async function POST(request: Request) {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "texts 배열이 필요합니다 (최대 500개).", 400, parsed.error.flatten());
  }

  return Response.json({ results: await lookupTerms(parsed.data.texts) });
}
```

500개 상한을 둔다. 상한이 없으면 한 번의 호출이 DB를 오래 점유할 수 있다.

- [ ] **Step 4: 테스트 실행**

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: lookup 테스트 5개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add batch term lookup endpoint with similarity fallback"
```

---

### Task 12: 용어 목록·상세 화면

**Files:**
- Create: `apps/web/src/components/term-badges.tsx`, `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/app/terms/page.tsx`, `apps/web/src/app/terms/[slug]/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (`/terms`로 리다이렉트)

**Interfaces:**
- Consumes: `listTerms`, `getTermByIdOrSlug`, `getCurrentUser`
- Produces: `<StatusBadge status>`, `<DomainBadges domain>`, `<AppShell user>` 컴포넌트

- [ ] **Step 1: 공통 컴포넌트 작성**

`apps/web/src/components/term-badges.tsx`:
```tsx
const STATUS_LABEL: Record<string, string> = {
  draft: "초안", approved: "승인됨", deprecated: "폐기됨", forbidden: "금지어",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-800",
  deprecated: "bg-amber-100 text-amber-800",
  forbidden: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.draft}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function DomainBadges({ domain }: { domain: string[] }) {
  if (domain.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {domain.map((d) => (
        <span key={d} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{d}</span>
      ))}
    </span>
  );
}
```

`apps/web/src/components/app-shell.tsx`:
```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";

export function AppShell({ user, children }: { user: CurrentUser | null; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/terms" className="font-semibold">용어집</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/terms/new" className="text-slate-600 hover:text-slate-900">새 용어</Link>
            <Link href="/import" className="text-slate-600 hover:text-slate-900">임포트</Link>
            <Link href="/settings/api-keys" className="text-slate-600 hover:text-slate-900">API 키</Link>
            <span className="text-slate-400">{user?.name ?? ""}</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: 목록 페이지 작성**

`apps/web/src/app/terms/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listTerms } from "@/lib/terms/query";

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; domain?: string; status?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const { items, total } = await listTerms({
    q: params.q, domain: params.domain, status: params.status, page, pageSize: 20,
  });

  return (
    <AppShell user={user}>
      <form className="mb-6 flex gap-2">
        <input name="q" defaultValue={params.q ?? ""} placeholder="용어, 약어, 별칭으로 검색"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-white">검색</button>
      </form>

      <p className="mb-3 text-sm text-slate-500">{total}개</p>

      <ul className="divide-y divide-slate-200">
        {items.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-3">
            <div>
              <Link href={`/terms/${t.slug}`} className="font-medium hover:underline">
                {t.nameEn ?? t.nameKo}
              </Link>
              {t.nameEn && t.nameKo && <span className="ml-2 text-sm text-slate-500">{t.nameKo}</span>}
            </div>
            <div className="flex items-center gap-2">
              <DomainBadges domain={t.domain} />
              <StatusBadge status={t.status} />
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && <p className="py-8 text-slate-500">결과가 없습니다.</p>}
    </AppShell>
  );
}
```

- [ ] **Step 3: 상세 페이지 작성**

`apps/web/src/app/terms/[slug]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const KIND_LABEL: Record<string, string> = {
  canonical: "표준", abbreviation: "약어", full_name: "풀네임",
  alias: "별칭", discouraged: "비권장", forbidden: "금지",
};

export default async function TermDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  return (
    <AppShell user={user}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{term.nameEn ?? term.nameKo}</h1>
          {term.nameEn && term.nameKo && <p className="mt-1 text-slate-600">{term.nameKo}</p>}
          {term.fullNameEn && <p className="mt-1 text-sm text-slate-500">{term.fullNameEn}</p>}
          <div className="mt-2 flex items-center gap-2">
            <DomainBadges domain={term.domain} />
            <StatusBadge status={term.status} />
          </div>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href={`/terms/${term.slug}/edit`} className="text-slate-600 hover:text-slate-900">편집</Link>
          <Link href={`/terms/${term.slug}/history`} className="text-slate-600 hover:text-slate-900">이력</Link>
        </div>
      </div>

      {term.homonyms.length > 0 && (
        <div className="mb-6 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-900">같은 표기의 다른 용어가 있습니다</p>
          <ul className="space-y-0.5">
            {term.homonyms.map((h) => (
              <li key={h.id}>
                <Link href={`/terms/${h.slug}`} className="text-amber-900 underline">
                  {h.nameEn ?? h.nameKo}
                </Link>
                {h.domain.length > 0 && <span className="ml-2 text-amber-700">({h.domain.join(", ")})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {term.definitionMd && <p className="mb-6 text-slate-800">{term.definitionMd}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">등록된 표기</h2>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {term.surfaces.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{s.text}</span>
              <span className="text-slate-500">{KIND_LABEL[s.kind] ?? s.kind} · {s.lang}</span>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/terms");
}
```

- [ ] **Step 4: 화면 확인**

```bash
pnpm --filter @grossary/web dev
```
로그인 후 `/terms`에서 목록이 뜨고, 별칭으로 검색해도 결과가 나오고, 상세에서 동음이의어 배너와 표기 목록이 보이는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add term list and detail pages"
```

---

### Task 13: 용어 생성·편집 폼

**Files:**
- Create: `apps/web/src/components/term-form.tsx`
- Create: `apps/web/src/app/terms/new/page.tsx`, `apps/web/src/app/terms/[slug]/edit/page.tsx`, `apps/web/src/app/terms/[slug]/history/page.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/terms`, `PATCH /api/v1/terms/{idOrSlug}`, `listRevisions`
- Produces: `<TermForm mode initial onSaved>` — 저장 후 `warnings`를 화면에 표시

- [ ] **Step 1: 폼 컴포넌트 작성**

`apps/web/src/components/term-form.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SurfaceDraft { text: string; lang: string; kind: string }

export interface TermFormInitial {
  slug?: string;
  termType: string;
  nameEn: string;
  nameKo: string;
  fullNameEn: string;
  fullNameKo: string;
  domain: string;
  status: string;
  definitionMd: string;
  surfaces: SurfaceDraft[];
}

const EMPTY: TermFormInitial = {
  termType: "term", nameEn: "", nameKo: "", fullNameEn: "", fullNameKo: "",
  domain: "", status: "draft", definitionMd: "", surfaces: [],
};

export function TermForm({ initial = EMPTY }: { initial?: TermFormInitial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [warnings, setWarnings] = useState<{ surfaceText: string; conflictingSlug: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof TermFormInitial>(key: K, value: TermFormInitial[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      termType: form.termType,
      nameEn: form.nameEn || undefined,
      nameKo: form.nameKo || undefined,
      fullNameEn: form.fullNameEn || undefined,
      fullNameKo: form.fullNameKo || undefined,
      domain: form.domain.split(",").map((d) => d.trim()).filter(Boolean),
      status: form.status,
      definitionMd: form.definitionMd || undefined,
      surfaces: form.surfaces.filter((s) => s.text.trim()),
    };

    const res = await fetch(initial.slug ? `/api/v1/terms/${initial.slug}` : "/api/v1/terms", {
      method: initial.slug ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "저장에 실패했습니다.");
      return;
    }

    const body = await res.json();
    if (body.warnings?.length) {
      setWarnings(body.warnings);
      return;
    }
    router.push(`/terms/${body.term.slug}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">영문 표준 표기
          <input value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">한글 표준 표기
          <input value={form.nameKo} onChange={(e) => set("nameKo", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">영문 풀네임
          <input value={form.fullNameEn} onChange={(e) => set("fullNameEn", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">한글 풀네임
          <input value={form.fullNameKo} onChange={(e) => set("fullNameKo", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">종류
          <select value={form.termType} onChange={(e) => set("termType", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2">
            {["term", "abbreviation", "project", "product_id", "code", "unit"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">상태
          <select value={form.status} onChange={(e) => set("status", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2">
            {["draft", "approved", "deprecated", "forbidden"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm">도메인 (쉼표 구분)
        <input value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="ISP, HW"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>

      <label className="block text-sm">정의
        <textarea value={form.definitionMd} onChange={(e) => set("definitionMd", e.target.value)} rows={3}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>

      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">추가 표기</legend>
        {form.surfaces.map((s, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input value={s.text} placeholder="표기"
              onChange={(e) => {
                const next = [...form.surfaces];
                next[i] = { ...s, text: e.target.value };
                set("surfaces", next);
              }}
              className="flex-1 rounded border border-slate-300 px-3 py-2" />
            <select value={s.kind}
              onChange={(e) => {
                const next = [...form.surfaces];
                next[i] = { ...s, kind: e.target.value };
                set("surfaces", next);
              }}
              className="rounded border border-slate-300 px-2">
              {["alias", "discouraged", "forbidden", "abbreviation", "full_name"].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <select value={s.lang}
              onChange={(e) => {
                const next = [...form.surfaces];
                next[i] = { ...s, lang: e.target.value };
                set("surfaces", next);
              }}
              className="rounded border border-slate-300 px-2">
              {["neutral", "en", "ko"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        ))}
        <button type="button"
          onClick={() => set("surfaces", [...form.surfaces, { text: "", lang: "neutral", kind: "alias" }])}
          className="text-sm text-slate-600 hover:text-slate-900">
          + 표기 추가
        </button>
      </fieldset>

      {warnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-900">이미 같은 표기의 용어가 있습니다</p>
          <ul className="mb-2 space-y-0.5 text-amber-900">
            {warnings.map((w, i) => <li key={i}>{w.surfaceText} → {w.conflictingSlug}</li>)}
          </ul>
          <p className="text-amber-700">저장은 완료되었습니다. 동음이의어가 맞는지 확인하세요.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={saving}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 페이지 3개 작성**

`apps/web/src/app/terms/new/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function NewTermPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="mb-6 text-xl font-semibold">새 용어</h1>
      <TermForm />
    </AppShell>
  );
}
```

`apps/web/src/app/terms/[slug]/edit/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const DERIVED = new Set(["canonical", "abbreviation", "full_name"]);

export default async function EditTermPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  return (
    <AppShell user={user}>
      <h1 className="mb-6 text-xl font-semibold">용어 편집</h1>
      <TermForm
        initial={{
          slug: term.slug,
          termType: term.termType,
          nameEn: term.nameEn ?? "",
          nameKo: term.nameKo ?? "",
          fullNameEn: term.fullNameEn ?? "",
          fullNameKo: term.fullNameKo ?? "",
          domain: term.domain.join(", "),
          status: term.status,
          definitionMd: term.definitionMd ?? "",
          surfaces: term.surfaces
            .filter((s) => !DERIVED.has(s.kind))
            .map((s) => ({ text: s.text, lang: s.lang, kind: s.kind })),
        }}
      />
    </AppShell>
  );
}
```

표준 표기에서 파생된 표기는 폼에 다시 넣지 않는다. 서버가 저장 시 다시 파생시키므로 중복 입력이 된다.

`apps/web/src/app/terms/[slug]/history/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listRevisions } from "@/lib/terms/update";

export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  const revisions = await listRevisions(term.id);

  return (
    <AppShell user={user}>
      <h1 className="mb-6 text-xl font-semibold">{term.nameEn ?? term.nameKo} 변경 이력</h1>
      <ul className="divide-y divide-slate-200">
        {revisions.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-3 text-sm">
            <span className="font-medium">#{r.revisionNumber}</span>
            <span className="text-slate-500">{r.message}</span>
            <span className="text-slate-400">{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
```

diff 뷰와 revert는 M3에서 붙인다. M1은 "언제 누가 몇 번 고쳤는지"만 보여준다.

- [ ] **Step 3: 타입 검사와 화면 확인**

```bash
pnpm --filter @grossary/web typecheck
pnpm --filter @grossary/web dev
```
`/terms/new`에서 용어를 만들고, 같은 표기를 다시 만들어 경고 배너가 뜨는지, 편집 후 `/terms/<slug>/history`에 리비전 2개가 보이는지 확인.

- [ ] **Step 4: E2E 흐름 수동 검증**

용어 등록 → 별칭으로 검색 → 상세 진입 → 편집 → 이력 확인까지 한 번 통과.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add term create, edit, and history pages"
```

---

### Task 14: 엑셀 임포트 (dry-run 포함)

**Files:**
- Create: `apps/web/src/lib/import/parse-xlsx.ts`, `apps/web/src/lib/import/apply.ts`
- Create: `apps/web/src/app/api/v1/import/route.ts`
- Create: `apps/web/src/app/import/page.tsx`
- Test: `apps/web/tests/import-parse.test.ts`

**Interfaces:**
- Consumes: `createTerm`, `findDuplicates`, `surfaceKeys`
- Produces:
  - `parseGlossaryWorkbook(buffer: ArrayBuffer): Promise<{ rows: ImportRow[]; errors: RowError[] }>`
  - `interface ImportRow { rowNumber: number; termType; nameEn?; nameKo?; fullNameEn?; fullNameKo?; domain: string[]; status; definitionMd?; aliases: string[] }`
  - `dryRunImport(rows: ImportRow[], errors: RowError[]): Promise<ImportReport>`
  - `applyImport(rows: ImportRow[], authorId: string | null): Promise<{ created: number }>`
  - `interface ImportReport { total: number; ready: number; conflicts: { rowNumber: number; name: string; conflictingSlug: string }[]; duplicatesInFile: { key: string; rowNumbers: number[] }[]; errors: RowError[] }`

- [ ] **Step 1: 파서 테스트 작성**

`apps/web/tests/import-parse.test.ts`:
```ts
import ExcelJS from "exceljs";
import { expect, test } from "vitest";
import { parseGlossaryWorkbook } from "../src/lib/import/parse-xlsx.js";

async function workbook(rows: (string | undefined)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["name_en", "name_ko", "full_name_en", "term_type", "domain", "status", "definition", "aliases"]);
  for (const row of rows) ws.addRow(row);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

test("헤더를 인식하고 행을 파싱한다", async () => {
  const buf = await workbook([
    ["AE", "자동노출", "Auto Exposure", "abbreviation", "ISP", "approved", "노출 자동 제어", "오토익스포저"],
  ]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);

  expect(errors).toEqual([]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    rowNumber: 2, nameEn: "AE", nameKo: "자동노출", fullNameEn: "Auto Exposure",
    termType: "abbreviation", domain: ["ISP"], status: "approved", aliases: ["오토익스포저"],
  });
});

test("도메인과 별칭의 쉼표 구분을 분리한다", async () => {
  const buf = await workbook([["Gain", "게인", "", "term", "ISP, HW", "approved", "", "gain value, 이득"]]);
  const { rows } = await parseGlossaryWorkbook(buf);

  expect(rows[0]!.domain).toEqual(["ISP", "HW"]);
  expect(rows[0]!.aliases).toEqual(["gain value", "이득"]);
});

test("표준 표기가 둘 다 비면 에러 행으로 분류한다", async () => {
  const buf = await workbook([["", "", "", "term", "ISP", "approved", "설명만 있음", ""]]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);

  expect(rows).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.rowNumber).toBe(2);
});

test("알 수 없는 status는 draft로 떨어뜨린다", async () => {
  const buf = await workbook([["Gain", "", "", "term", "", "확인중", "", ""]]);
  const { rows } = await parseGlossaryWorkbook(buf);
  expect(rows[0]!.status).toBe("draft");
});

test("완전히 빈 행은 건너뛴다", async () => {
  const buf = await workbook([[], ["Gain", "", "", "term", "", "approved", "", ""]]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);
  expect(rows).toHaveLength(1);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: 실패 확인 후 파서 구현**

Run: `pnpm --filter @grossary/web add exceljs && DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: FAIL — 모듈 없음

`apps/web/src/lib/import/parse-xlsx.ts`:
```ts
import ExcelJS from "exceljs";

export interface ImportRow {
  rowNumber: number;
  termType: "term" | "abbreviation" | "project" | "product_id" | "code" | "unit";
  nameEn?: string;
  nameKo?: string;
  fullNameEn?: string;
  fullNameKo?: string;
  domain: string[];
  status: "draft" | "approved" | "deprecated" | "forbidden";
  definitionMd?: string;
  aliases: string[];
}

export interface RowError { rowNumber: number; message: string }

const TERM_TYPES = new Set(["term", "abbreviation", "project", "product_id", "code", "unit"]);
const STATUSES = new Set(["draft", "approved", "deprecated", "forbidden"]);

const HEADER_ALIASES: Record<string, keyof ImportRow | "aliases"> = {
  name_en: "nameEn", "영문": "nameEn", "english": "nameEn",
  name_ko: "nameKo", "한글": "nameKo", "korean": "nameKo",
  full_name_en: "fullNameEn", "풀네임": "fullNameEn",
  full_name_ko: "fullNameKo",
  term_type: "termType", "종류": "termType",
  domain: "domain", "도메인": "domain",
  status: "status", "상태": "status",
  definition: "definitionMd", "정의": "definitionMd", "설명": "definitionMd",
  aliases: "aliases", "별칭": "aliases",
};

function splitList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  return String(value).trim();
}

export async function parseGlossaryWorkbook(
  buffer: ArrayBuffer,
): Promise<{ rows: ImportRow[]; errors: RowError[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ rowNumber: 0, message: "시트를 찾을 수 없습니다." }] };

  const columnMap = new Map<number, keyof ImportRow | "aliases">();
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).toLowerCase().replace(/\s+/g, "_");
    const mapped = HEADER_ALIASES[key];
    if (mapped) columnMap.set(col, mapped);
  });

  if (columnMap.size === 0) {
    return { rows: [], errors: [{ rowNumber: 1, message: "인식 가능한 헤더가 없습니다." }] };
  }

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const raw: Record<string, string> = {};
    for (const [col, field] of columnMap) raw[field] = cellText(row.getCell(col).value);

    if (Object.values(raw).every((v) => v === "")) return;

    const nameEn = raw.nameEn || undefined;
    const nameKo = raw.nameKo || undefined;
    if (!nameEn && !nameKo) {
      errors.push({ rowNumber, message: "영문 또는 한글 표준 표기가 필요합니다." });
      return;
    }

    const termType = TERM_TYPES.has(raw.termType ?? "") ? (raw.termType as ImportRow["termType"]) : "term";
    const status = STATUSES.has(raw.status ?? "") ? (raw.status as ImportRow["status"]) : "draft";

    rows.push({
      rowNumber,
      termType,
      nameEn,
      nameKo,
      fullNameEn: raw.fullNameEn || undefined,
      fullNameKo: raw.fullNameKo || undefined,
      domain: splitList(raw.domain ?? ""),
      status,
      definitionMd: raw.definitionMd || undefined,
      aliases: splitList(raw.aliases ?? ""),
    });
  });

  return { rows, errors };
}
```

헤더 이름을 한국어와 영어 양쪽으로 받는다. 기존 엑셀 파일이 어떤 헤더를 쓰는지 미리 알 수 없으므로 관대하게 매핑하고, 인식 못 한 헤더는 조용히 무시한다.

- [ ] **Step 3: dry-run과 반영 구현**

`apps/web/src/lib/import/apply.ts`:
```ts
import { surfaceKeys } from "@grossary/db";
import { createTerm, findDuplicates } from "@/lib/terms/create";
import type { ImportRow, RowError } from "./parse-xlsx";

export interface ImportReport {
  total: number;
  ready: number;
  conflicts: { rowNumber: number; name: string; conflictingSlug: string }[];
  duplicatesInFile: { key: string; rowNumbers: number[] }[];
  errors: RowError[];
}

function displayName(row: ImportRow): string {
  return row.nameEn ?? row.nameKo ?? "";
}

function surfacesOf(row: ImportRow) {
  return [
    ...(row.nameEn ? [{ text: row.nameEn, lang: "en" as const, kind: "canonical" as const }] : []),
    ...(row.nameKo ? [{ text: row.nameKo, lang: "ko" as const, kind: "canonical" as const }] : []),
    ...row.aliases.map((a) => ({ text: a, lang: "neutral" as const, kind: "alias" as const })),
  ];
}

export async function dryRunImport(rows: ImportRow[], errors: RowError[]): Promise<ImportReport> {
  const seen = new Map<string, number[]>();
  for (const row of rows) {
    for (const s of surfacesOf(row)) {
      const key = surfaceKeys(s.text).normLoose;
      if (!key) continue;
      seen.set(key, [...(seen.get(key) ?? []), row.rowNumber]);
    }
  }

  const duplicatesInFile = [...seen.entries()]
    .filter(([, numbers]) => new Set(numbers).size > 1)
    .map(([key, numbers]) => ({ key, rowNumbers: [...new Set(numbers)] }));

  const conflicts: ImportReport["conflicts"] = [];
  for (const row of rows) {
    const warnings = await findDuplicates(surfacesOf(row));
    for (const w of warnings) {
      conflicts.push({ rowNumber: row.rowNumber, name: displayName(row), conflictingSlug: w.conflictingSlug });
    }
  }

  return {
    total: rows.length + errors.length,
    ready: rows.length,
    conflicts,
    duplicatesInFile,
    errors,
  };
}

export async function applyImport(rows: ImportRow[], authorId: string | null): Promise<{ created: number }> {
  let created = 0;
  for (const row of rows) {
    await createTerm(
      {
        termType: row.termType,
        nameEn: row.nameEn,
        nameKo: row.nameKo,
        fullNameEn: row.fullNameEn,
        fullNameKo: row.fullNameKo,
        domain: row.domain,
        status: row.status,
        definitionMd: row.definitionMd,
        surfaces: row.aliases.map((a) => ({ text: a, lang: "neutral" as const, kind: "alias" as const })),
      },
      authorId,
    );
    created += 1;
  }
  return { created };
}
```

`apps/web/src/app/api/v1/import/route.ts`:
```ts
import { apiError } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { parseGlossaryWorkbook } from "@/lib/import/parse-xlsx";
import { applyImport, dryRunImport } from "@/lib/import/apply";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const form = await request.formData();
  const file = form.get("file");
  const dryRun = form.get("dryRun") !== "false";

  if (!(file instanceof File)) {
    return apiError("validation_failed", "file 필드에 xlsx 파일이 필요합니다.", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError("payload_too_large", "파일이 10MB를 넘습니다.", 413);
  }

  const { rows, errors } = await parseGlossaryWorkbook(await file.arrayBuffer());

  if (dryRun) {
    return Response.json({ dryRun: true, report: await dryRunImport(rows, errors) });
  }

  const authorId = auth.kind === "user" ? auth.user.id : null;
  const { created } = await applyImport(rows, authorId);
  return Response.json({ dryRun: false, created, skipped: errors.length, errors });
}
```

- [ ] **Step 4: 임포트 화면 작성 후 테스트 실행**

`apps/web/src/app/import/page.tsx`:
```tsx
"use client";

import { useState } from "react";

interface Report {
  total: number; ready: number;
  conflicts: { rowNumber: number; name: string; conflictingSlug: string }[];
  duplicatesInFile: { key: string; rowNumbers: number[] }[];
  errors: { rowNumber: number; message: string }[];
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("dryRun", String(dryRun));

    const res = await fetch("/api/v1/import", { method: "POST", body });
    const data = await res.json();
    setBusy(false);

    if (dryRun) setReport(data.report);
    else setApplied(data.created);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold">엑셀 임포트</h1>

      <input type="file" accept=".xlsx"
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setApplied(null); }}
        className="mb-4 block" />

      <button onClick={() => send(true)} disabled={!file || busy}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        검사만 실행 (dry-run)
      </button>

      {report && (
        <section className="mt-6 space-y-4 text-sm">
          <p>총 {report.total}행 중 {report.ready}행 등록 가능</p>

          {report.errors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <p className="mb-1 font-medium text-red-900">건너뛸 행 {report.errors.length}개</p>
              <ul>{report.errors.map((e, i) => <li key={i}>{e.rowNumber}행: {e.message}</li>)}</ul>
            </div>
          )}

          {report.duplicatesInFile.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 font-medium text-amber-900">파일 안에서 중복된 표기</p>
              <ul>{report.duplicatesInFile.map((d, i) => (
                <li key={i}>{d.key} — {d.rowNumbers.join(", ")}행</li>
              ))}</ul>
            </div>
          )}

          {report.conflicts.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 font-medium text-amber-900">이미 등록된 용어와 겹침</p>
              <ul>{report.conflicts.map((c, i) => (
                <li key={i}>{c.rowNumber}행 {c.name} → {c.conflictingSlug}</li>
              ))}</ul>
            </div>
          )}

          <button onClick={() => send(false)} disabled={busy}
            className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">
            {report.ready}개 실제로 등록하기
          </button>
        </section>
      )}

      {applied !== null && <p className="mt-4 text-sm text-emerald-800">{applied}개 용어를 등록했습니다.</p>}
    </main>
  );
}
```

Run: `DATABASE_URL_TEST=... pnpm --filter @grossary/web test`
Expected: import-parse 테스트 5개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add xlsx glossary import with dry-run report"
```

---

### Task 15: 프로덕션 Docker + 백업 스크립트 + OpenAPI 문서

**Files:**
- Create: `Dockerfile`, `docker-compose.prod.yml`, `.dockerignore`, `scripts/init-prod-db.sql`
- Create: `scripts/backup.sh`, `scripts/restore.sh`
- Create: `apps/web/src/app/api/v1/openapi/route.ts`, `apps/web/src/app/api/docs/page.tsx`
- Create: `docs/operations.md`

**Interfaces:**
- Consumes: Task 5~14의 전체 앱
- Produces: `docker compose -f docker-compose.prod.yml up -d`로 기동하는 배포 구성, `scripts/backup.sh` / `scripts/restore.sh`

- [ ] **Step 1: Dockerfile 작성**

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm --filter @grossary/engine build && pnpm --filter @grossary/web build

FROM build AS migrator
CMD ["pnpm", "--filter", "@grossary/db", "db:migrate"]

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

`.dockerignore`:
```
node_modules
**/node_modules
.next
**/.next
.turbo
.git
backups
```

`docker-compose.prod.yml`:
```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://grossary:${POSTGRES_PASSWORD}@postgres:5432/grossary
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully

  migrate:
    build:
      context: .
      target: migrator
    restart: "no"
    environment:
      DATABASE_URL: postgres://grossary:${POSTGRES_PASSWORD}@postgres:5432/grossary
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: grossary
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: grossary
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-prod-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U grossary"]
      interval: 5s
      retries: 10

volumes:
  pgdata:
    name: grossary_pgdata
```

`scripts/init-prod-db.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

기동 순서는 postgres(healthy) → migrate(1회 실행 후 종료) → app이다. 마이그레이션이
실패하면 app이 아예 뜨지 않는다. 스키마가 어긋난 채로 서비스가 열리는 것보다 낫다.

- [ ] **Step 2: 백업·복구 스크립트 작성**

`scripts/backup.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$OUT_DIR/grossary-$STAMP.dump"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U grossary -Fc grossary > "$OUT"

echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
```

`scripts/restore.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file>}"

docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U grossary -d postgres -c "DROP DATABASE IF EXISTS grossary;"
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U grossary -d postgres -c "CREATE DATABASE grossary;"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U grossary -d grossary --no-owner < "$DUMP"

echo "restored from $DUMP"
```

- [ ] **Step 3: OpenAPI 문서 라우트 작성**

`apps/web/src/app/api/v1/openapi/route.ts`:
```ts
const spec = {
  openapi: "3.1.0",
  info: { title: "Grossary API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "glk_<prefix>_<secret>" } },
  },
  security: [{ apiKey: [] }],
  paths: {
    "/health": { get: { summary: "상태 확인", responses: { "200": { description: "정상" } } } },
    "/terms": {
      get: {
        summary: "용어 목록·검색",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" } },
          { name: "domain", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: { "200": { description: "목록" } },
      },
      post: { summary: "용어 생성 (중복 시 warnings 동반)", responses: { "201": { description: "생성됨" } } },
    },
    "/terms/lookup": {
      post: { summary: "표기 배치 조회", responses: { "200": { description: "조회 결과" } } },
    },
    "/terms/{idOrSlug}": {
      get: { summary: "용어 상세", responses: { "200": { description: "상세" }, "404": { description: "없음" } } },
      patch: { summary: "용어 수정", responses: { "200": { description: "수정됨" }, "409": { description: "리비전 충돌" } } },
      delete: { summary: "용어 삭제 (관리자)", responses: { "204": { description: "삭제됨" } } },
    },
    "/terms/{idOrSlug}/revisions": {
      get: { summary: "변경 이력", responses: { "200": { description: "이력" } } },
    },
    "/import": { post: { summary: "엑셀 임포트 (dryRun 기본 true)", responses: { "200": { description: "리포트 또는 반영 결과" } } } },
    "/keys": {
      get: { summary: "API 키 목록", responses: { "200": { description: "목록" } } },
      post: { summary: "API 키 발급 (평문 토큰은 이 응답에만 노출)", responses: { "201": { description: "발급됨" } } },
    },
  },
} as const;

export function GET() {
  return Response.json(spec);
}
```

`apps/web/src/app/api/docs/page.tsx`:
```tsx
export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-4 text-xl font-semibold">API 문서</h1>
      <p className="mb-4 text-sm text-slate-600">
        OpenAPI 3.1 스펙은 <code className="rounded bg-slate-100 px-1">/api/v1/openapi</code> 에서 받을 수 있습니다.
        AI-Lint 클라이언트는 이 스펙으로 생성하세요.
      </p>
      <pre className="overflow-x-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
{`curl -s http://<host>/api/v1/openapi > openapi.json
npx openapi-typescript openapi.json -o src/generated/glossary.ts`}
      </pre>
    </main>
  );
}
```

M1의 스펙은 손으로 유지한다. zod에서 자동 생성하는 파이프라인은 엔드포인트가 훨씬 늘어나는 M2에서 붙이는 편이 낫다. 지금 도입하면 라우트 6개를 위해 생성기를 배선하는 비용이 더 크다.

- [ ] **Step 4: 운영 문서 작성 후 전체 검증**

`docs/operations.md`:
```markdown
# 운영 가이드

## 최초 기동

    cp .env.example .env          # POSTGRES_PASSWORD를 실제 값으로 교체
    docker compose -f docker-compose.prod.yml up -d

`up -d` 하나로 postgres → migrate → app 순서로 기동한다. pg_trgm 확장은
`scripts/init-prod-db.sql`이 볼륨 최초 생성 시 만들고, 스키마는 migrate 서비스가 적용한다.

관리자 계정은 migrator 이미지에서 한 번 만든다:

    docker compose -f docker-compose.prod.yml run --rm migrate \
      pnpm --filter @grossary/web exec tsx scripts/seed-admin.ts <email> <password> <name>

## 백업

    ./scripts/backup.sh /var/backups/grossary

이미지 첨부까지 DB 안에 있으므로 이 dump 파일 하나가 전체 백업이다.
cron 예시 (매일 03:00):

    0 3 * * * cd /opt/grossary && ./scripts/backup.sh /var/backups/grossary

## 복구 및 서버 이동

    ./scripts/restore.sh /var/backups/grossary/grossary-20260824-030000.dump

**복구 절차는 실제로 한 번 실행해서 확인한 뒤 운영에 들어간다.** 검증하지 않은 백업은 백업이 아니다.

## 주의

- Compose 볼륨 이름은 `grossary_pgdata`로 고정되어 있다. 이 이름을 바꾸면 기존 데이터에
  접근할 수 없게 된다.
- API 키 평문 토큰은 발급 응답에서만 볼 수 있다. 분실하면 재발급해야 한다.
```

전체 검증:
```bash
pnpm install
pnpm build
pnpm typecheck
DATABASE_URL_TEST=postgres://grossary:grossary@localhost:5432/grossary_test pnpm test
docker compose -f docker-compose.prod.yml build
```
Expected: 타입 검사 통과, 전체 테스트 통과, 이미지 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add production docker setup, backup scripts, and openapi spec"
```

---

## M1 완료 기준

- [ ] 관리자 계정으로 로그인해 용어를 등록·수정·삭제할 수 있다.
- [ ] 별칭이나 표기 변형(`auto-exposure`, `AutoExposure`)으로 검색해도 해당 용어에 도달한다.
- [ ] 같은 표기를 다시 등록하면 저장은 되되 경고가 표시된다.
- [ ] 동음이의어가 있는 용어의 상세 페이지에 다른 용어 목록이 나온다.
- [ ] 수정할 때마다 리비전이 쌓이고 이력 페이지에서 확인된다.
- [ ] API Key로 `GET /terms`, `POST /terms/lookup`을 호출할 수 있고, scope가 없으면 403이 난다.
- [ ] 엑셀 파일을 dry-run으로 검사해 충돌·중복·오류 행을 확인한 뒤 실제 등록할 수 있다.
- [ ] `docker compose -f docker-compose.prod.yml up -d`로 기동되고 `scripts/backup.sh` → `scripts/restore.sh` 왕복이 검증됐다.

## M2로 넘기는 것

`packages/engine`의 정규화 함수는 M1에서 완성됐고, M2는 그 위에 Aho-Corasick 매칭·세그먼트 분리·경계 판정·규칙 적용을 얹는다. `/validate`, `/validate/batch`, `/lexicon`, `/candidates`, `/check` 화면이 M2 범위다. 마크다운 본문·이미지·diff/revert·병합 UI는 M3다.
