import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, test } from "vitest";
import { vi } from "vitest";
import { AccountMenu } from "../src/components/account-menu.js";
import { AppShell } from "../src/components/app-shell.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

test("사이드바 탐색과 상단 검색·생성·계정 영역을 분리한다", () => {
  const html = renderToStaticMarkup(AppShell({
    user: { id: "editor-1", email: "editor@example.com", name: "편집자", role: "editor" },
    title: "시트",
    children: "본문",
  }));

  expect(html).toContain('id="primary-navigation"');
  expect(html).not.toContain('title="검색 · 홈"');
  expect(html).toContain('role="search"');
  expect(html).toContain('<h1 class="sr-only min-w-0 truncate text-sm font-semibold tracking-tight text-ink lg:not-sr-only">시트</h1>');
  expect(html).toContain('placeholder="용어 · 약어 · 별칭 · 금지 표기…"');
  expect(html).toContain('aria-keyshortcuts="/"');
  expect(html).toContain('aria-label="새 용어 추가"');
  expect(html).toContain('aria-label="편집자 계정 메뉴"');
  expect(html).toContain('aria-label="함께 정리 · 미완성"');
  expect(html).toContain('sidebar-expanded-only hidden whitespace-nowrap lg:inline');
  expect(html).toContain('title="사이드바 접기"');
  expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf('aria-label="편집자 계정 메뉴"'));
});

test("설정과 관리자 링크는 개인 계정 하위 메뉴에 있다", () => {
  const html = renderToStaticMarkup(createElement(AccountMenu, {
    user: { id: "admin-1", email: "admin@example.com", name: "관리자", role: "admin" },
    current: "admin",
  }));

  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('href="/settings"');
  expect(html).toContain('href="/admin"');
  expect(html).toContain('id="account-submenu"');
});
