import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { openApiSpec } from "../src/lib/openapi.js";

// 에이전트 스킬과 /api 안내 페이지는 에이전트가 실제로 따라 하는 호출 목록이다.
// 둘 다 손으로 유지되므로 경로가 바뀌면 에이전트가 404를 받고서야 알게 된다.
// R129(openapi.test.ts)가 라우트 디렉터리와 스펙을 잠그고, 여기서는 문서와 스펙을 잠근다.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(testDir, "..", "..", "..", "skills", "glossary");
const apiPagePath = path.join(testDir, "..", "src", "app", "api", "page.tsx");
const specPaths = openApiSpec.paths as Record<string, Record<string, unknown>>;

interface Call {
  method: string;
  path: string;
  source: string;
}

function normalizePath(raw: string): string {
  return raw.replace(/^\/api\/v1/, "").split("?")[0]!.replace(/\/$/, "") || "/";
}

// 예시 요청은 `/terms/auto-exposure`처럼 실제 slug를 쓰므로 스펙의 {param} 템플릿과 맞춘다.
// 고정 경로가 있으면 그쪽이 우선이다(`/terms/catalog`가 `/terms/{idOrSlug}`로 잡히면 안 된다).
function specOperation(call: Call): unknown {
  const exact = specPaths[call.path];
  if (exact) return exact[call.method];
  const template = Object.keys(specPaths).find((specPath) =>
    new RegExp(`^${specPath.replace(/\{[^/]+\}/g, "[^/]+")}$`).test(call.path),
  );
  return template ? specPaths[template]![call.method] : undefined;
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

function skillCalls(): Call[] {
  return markdownFiles(skillDir).flatMap((file) => {
    const source = path.relative(skillDir, file);
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/\b(GET|POST|PATCH|PUT|DELETE) (\/[A-Za-z0-9_{}\/.-]+(?:\?\S*)?)/g)].map((m) => ({
      method: m[1]!.toLowerCase(),
      path: normalizePath(m[2]!),
      source,
    }));
  });
}

function pageCalls(): Call[] {
  const text = readFileSync(apiPagePath, "utf8");
  return [...text.matchAll(/<Endpoint method="([^"]+)" path="([^"]+)"/g)].flatMap((m) =>
    m[1]!.split("·").map((method) => ({ method: method.trim().toLowerCase(), path: normalizePath(m[2]!), source: "api/page.tsx" })),
  );
}

test("스킬 문서에 적힌 호출이 모두 OpenAPI에 있다", () => {
  const calls = skillCalls();
  // vacuity 가드 — 정규식이 통째로 빗나가면 아래 루프가 그냥 통과한다.
  expect(calls.length).toBeGreaterThanOrEqual(20);
  expect(calls.map((c) => c.path)).toContain("/terms/batch");

  for (const call of calls) {
    expect(specOperation(call), `${call.source}: ${call.method.toUpperCase()} ${call.path}가 스펙에 없다`).toBeDefined();
  }
});

test("/api 페이지의 엔드포인트 목록이 모두 OpenAPI에 있다", () => {
  const calls = pageCalls();
  expect(calls.length).toBeGreaterThanOrEqual(10);

  for (const call of calls) {
    expect(specPaths[call.path]?.[call.method], `${call.method.toUpperCase()} ${call.path}가 스펙에 없다`).toBeDefined();
  }
});

test("스킬 원문 링크가 저장소의 실제 스킬 디렉터리를 가리킨다", () => {
  const text = readFileSync(apiPagePath, "utf8");
  const url = /SKILL_SOURCE_URL = "([^"]+)"/.exec(text)?.[1];
  expect(url).toMatch(/\/tree\/main\/skills\/glossary$/);
  expect(readdirSync(skillDir)).toContain("SKILL.md");
});
