import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { openApiSpec } from "../src/lib/openapi.js";

// R129: OpenAPI 스펙은 AI-Lint 통합의 계약인데 손으로 유지된다. 손으로 유지되는
// 리터럴은 구조 테스트로 잠근다 — R105(예약 slug), R107(라우트 디렉터리)와 같은
// 패턴이다. Next의 파일시스템 라우팅 덕분에 공허하지 않다: 새 라우트를 만들고
// 스펙에 안 넣으면 여기서 깨진다. 실제로 스케치 시점 스펙은 라우트 10개 중
// 7개만 담고 있었고 /auth/login, /auth/logout, /keys/{id}가 빠져 있었다.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(testDir, "..", "src", "app", "api", "v1");

// 캐치올은 "매칭되지 않은 모든 경로"를 규약대로 404로 만드는 장치라 URL이 없다.
// 명시적으로 예외로 둔다(전역 제약이 요구하는 라우트지만 문서화할 경로가 아니다).
const SPEC_EXEMPT = new Set(["/{...unmatched}"]);

interface RouteFile {
  specPath: string;
  methods: string[];
}

function collectRoutes(dir: string, segments: string[] = [], acc: RouteFile[] = []): RouteFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRoutes(full, [...segments, entry.name], acc);
    } else if (entry.name === "route.ts") {
      // Next의 [param]을 OpenAPI의 {param}으로 옮긴다.
      const specPath = "/" + segments.map((s) => s.replace(/^\[(.+)\]$/, "{$1}")).join("/");
      const src = readFileSync(full, "utf8");
      const match = /const ALLOWED_METHODS = \[([^\]]*)\]/.exec(src);
      const methods = match
        ? [...match[1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!.toLowerCase())
        : [];
      acc.push({ specPath, methods });
    }
  }
  return acc;
}

const routes = collectRoutes(apiRoot).filter((r) => !SPEC_EXEMPT.has(r.specPath));
const specPaths = openApiSpec.paths as Record<string, Record<string, unknown>>;

test("R129: app/api/v1/ 밑의 모든 라우트가 OpenAPI paths에 있다", () => {
  // vacuity 가드 — 수집이 통째로 실패하면 아래 루프가 그냥 통과한다.
  expect(routes.length).toBeGreaterThanOrEqual(10);
  expect(routes.map((r) => r.specPath)).toContain("/terms/lookup");

  for (const route of routes) {
    expect(Object.keys(specPaths), `${route.specPath}: 스펙에 없다`).toContain(route.specPath);
  }
});

test("R129: OpenAPI paths에 실제로 없는 라우트가 적혀 있지 않다", () => {
  const actual = new Set(routes.map((r) => r.specPath));
  for (const specPath of Object.keys(specPaths)) {
    expect(actual.has(specPath), `${specPath}: 스펙에는 있는데 라우트가 없다`).toBe(true);
  }
});

test("R129: 각 라우트의 ALLOWED_METHODS와 스펙에 적힌 메서드가 일치한다", () => {
  for (const route of routes) {
    const entry = specPaths[route.specPath];
    // path 레벨의 parameters는 메서드가 아니다.
    const documented = Object.keys(entry ?? {})
      .filter((k) => k !== "parameters")
      .sort();
    expect(documented, `${route.specPath}: 메서드 불일치`).toEqual([...route.methods].sort());
  }
});

test("R129: 에러 봉투 스키마가 실제 응답 모양과 같다", () => {
  const schema = openApiSpec.components.schemas.Error as {
    properties: { error: { required: string[]; properties: Record<string, unknown> } };
  };
  expect(schema.properties.error.required).toEqual(["code", "message"]);
  expect(Object.keys(schema.properties.error.properties).sort()).toEqual(["code", "details", "message"]);
});

test("R129: 인증 수단이 세션 쿠키와 API 키 둘 다 문서화돼 있다", () => {
  const schemes = openApiSpec.components.securitySchemes as Record<string, { name?: string }>;
  expect(Object.keys(schemes).sort()).toEqual(["apiKey", "sessionCookie"]);
  // 쿠키 이름은 lib/auth/session.ts의 SESSION_COOKIE와 같아야 한다.
  expect(schemes.sessionCookie!.name).toBe("grossary_session");
});
