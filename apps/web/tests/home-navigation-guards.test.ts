import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.join(testDir, "..", "src", "components");
const homeSource = readFileSync(path.join(testDir, "..", "src", "app", "page.tsx"), "utf8");

test("홈은 다른 화면과 같은 앱 셸(사이드바·상단 바·계정 메뉴)을 쓴다", () => {
  expect(homeSource).toContain("<AppShell user={user}");
  expect(homeSource).not.toContain("function HomeHeader");
  expect(homeSource).not.toContain("<AccountMenu");
  expect(homeSource).not.toContain("<ThemeToggle");
  expect(homeSource).not.toContain("<LogoutButton");
});

test("홈은 본문 검색창과 h1을 직접 가지므로 셸의 상단 검색을 끈다", () => {
  expect(homeSource).toContain("search={false}");
  const shellSource = readFileSync(path.join(componentsDir, "app-shell.tsx"), "utf8");
  expect(shellSource).toContain('const TitleTag = search ? "h1" : "p";');
});

test("히어로는 한 화면을 다 차지하지 않고 개념 수렴 예시로 제품의 축을 보여 준다", () => {
  expect(homeSource).toContain("<ConceptConvergence />");
  expect(homeSource).not.toContain("100svh");
  expect(homeSource).not.toContain("ScrollReveal");
  expect(existsSync(path.join(componentsDir, "home-flow-field.tsx"))).toBe(false);
  expect(existsSync(path.join(componentsDir, "scroll-reveal.tsx"))).toBe(false);
});

test("수렴 애니메이션은 모션 축소 설정과 일시정지를 존중한다", () => {
  const source = readFileSync(path.join(componentsDir, "concept-convergence.tsx"), "utf8");
  expect(source).toContain("prefers-reduced-motion: reduce");
  expect(source).toContain("const running = !paused && !hovered && !reducedMotion;");
  expect(source).toContain("aria-pressed={paused}");
});

test("API 안내 페이지가 앱 사이드바에서 발견되고 실제 사용법을 설명한다", () => {
  const shellSource = readFileSync(path.join(componentsDir, "app-shell.tsx"), "utf8");
  const apiPage = readFileSync(path.join(testDir, "..", "src", "app", "api", "page.tsx"), "utf8");
  expect(shellSource).toContain('{ key: "api", href: "/api", label: "API", hint: "개발자 연동"');
  expect(shellSource).toContain('{ key: "field-completion", href: "/contribute/fields", label: "필드 보완", hint: "정의 · 분류"');
  expect(apiPage).toContain('current="api"');
  expect(apiPage).toContain("Authorization: Bearer");
  expect(apiPage).toContain("GET /api/v1/openapi");
  expect(apiPage).toContain("expectedRevision");
});
