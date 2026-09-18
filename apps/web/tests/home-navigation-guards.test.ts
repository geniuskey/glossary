import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const homeSource = readFileSync(path.join(testDir, "..", "src", "app", "page.tsx"), "utf8");

test("홈 모바일 헤더에서도 용어 시트로 바로 이동할 수 있다", () => {
  expect(homeSource).toContain('className="btn-quiet h-9 w-9 touch-manipulation p-0 sm:hidden"');
  expect(homeSource).toContain('aria-label="용어 시트 열기"');
});

test("홈 헤더는 앱 셸과 같은 높이와 메뉴 체계를 사용한다", () => {
  expect(homeSource).toContain('className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6"');
  expect(homeSource).toContain('APP_NAV_ITEMS.filter');
  expect(homeSource).toContain('{item.label}');
  expect(homeSource).toContain('aria-label="새 용어 추가"');
  expect(homeSource).not.toContain('<HelpLink />');
  expect(homeSource).not.toContain('HelpLink,');
  expect(homeSource).not.toContain('>용어 둘러보기</Link>');
  expect(homeSource).not.toContain('>용어 제안하기</span>');
});

test("홈은 공용 계정 메뉴에서 설정·테마·로그아웃을 제공한다", () => {
  expect(homeSource).toContain('<AccountMenu user={user} placement="topbar" />');
  expect(homeSource.indexOf('aria-label="새 용어 추가"')).toBeLessThan(
    homeSource.indexOf('<AccountMenu user={user} placement="topbar" />'),
  );
  expect(homeSource).not.toContain("<ThemeToggle");
  expect(homeSource).not.toContain("<LogoutButton");
});

test("API 안내 페이지가 앱 사이드바에서 발견되고 실제 사용법을 설명한다", () => {
  const shellSource = readFileSync(path.join(testDir, "..", "src", "components", "app-shell.tsx"), "utf8");
  const apiPage = readFileSync(path.join(testDir, "..", "src", "app", "api", "page.tsx"), "utf8");
  expect(shellSource).toContain('{ key: "api", href: "/api", label: "API", hint: "개발자 연동"');
  expect(shellSource).toContain('{ key: "field-completion", href: "/contribute/fields", label: "필드 보완", hint: "정의 · 분류"');
  expect(apiPage).toContain('current="api"');
  expect(apiPage).toContain("Authorization: Bearer");
  expect(apiPage).toContain("GET /api/v1/openapi");
  expect(apiPage).toContain("expectedRevision");
});
