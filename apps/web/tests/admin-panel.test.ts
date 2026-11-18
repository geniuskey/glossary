import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { headerDraftsOf, headerPayload, newHeaderDraft } from "../src/lib/admin/header-drafts.js";
import {
  filterManagedUsers,
  hiddenSelectionCount,
  pageOf,
  roleChangeConfirmMessage,
} from "../src/lib/admin/user-list.js";
import { errorCodeLabel, operationLabel } from "../src/lib/ai/operation-labels.js";
import { ADMIN_NAV_GROUPS, ADMIN_TAB_ALIASES } from "../src/app/admin/admin-navigation.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminDir = path.join(root, "src", "app", "admin");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// 이름을 key에 섞으면(`${index}:${header.name}`) 이름 칸에 한 글자 칠 때마다 행이
// 새로 만들어져 포커스가 빠진다. 행 key는 이름과 무관한 고정 id여야 한다.
test("추가 요청 헤더 행은 이름과 무관한 고정 id를 key로 쓴다", () => {
  for (const file of ["ai-settings-panel.tsx", "rag-settings-panel.tsx"]) {
    const source = read("src", "app", "admin", file);
    expect(source, file).not.toContain("header.name}`}");
    expect(source, file).toContain("key={header.id}");
    // 서버 스키마는 strict라 화면 전용 id가 섞이면 저장이 400으로 실패한다.
    expect(source, file).toContain("headerPayload(");
  }
});

test("헤더 초안은 행마다 다른 id를 갖고, 서버로 보낼 때는 id를 뺀다", () => {
  const drafts = [...headerDraftsOf([{ name: "X-Team", configured: true }]), newHeaderDraft()];
  expect(new Set(drafts.map((item) => item.id)).size).toBe(2);
  expect(headerPayload(drafts)).toEqual([
    { name: "X-Team", value: "", configured: true },
    { name: "", value: "" },
  ]);
  // 같은 저장값에서 다시 만든 초안끼리는 payload가 같아야 "변경 없음"으로 판정된다.
  expect(headerPayload(headerDraftsOf([{ name: "A", configured: true }])))
    .toEqual(headerPayload(headerDraftsOf([{ name: "A", configured: true }])));
});

test("관리자 승격도 확인을 받고, 승격 문구는 관리자 권한 범위를 알려 준다", () => {
  expect(roleChangeConfirmMessage("홍길동", "viewer", "admin")).toContain("관리자로 지정할까요?");
  expect(roleChangeConfirmMessage("홍길동", "viewer", "admin")).toContain("AI 연결 비밀값");
  expect(roleChangeConfirmMessage("홍길동", "admin", "editor")).toContain("관리자 권한을 해제");
  expect(roleChangeConfirmMessage("홍길동", "viewer", "editor")).toBe("홍길동 사용자를 편집자로 변경할까요?");

  const panel = read("src", "app", "admin", "users-panel.tsx");
  expect(panel).toContain("if (!window.confirm(roleChangeConfirmMessage(");
  expect(panel).not.toContain('(role === "editor" || role === "viewer") && !window.confirm');
});

test("사용자 목록은 검색어·역할·로그인 방식을 함께 적용한다", () => {
  const users = [
    { id: "1", name: "김편집", email: "kim@example.com", organization: "카메라", role: "editor" as const, authType: "sso" as const },
    { id: "2", name: "이뷰어", email: "lee@example.com", organization: null, role: "viewer" as const, authType: "password" as const },
    { id: "3", name: "Codex", email: "agent-3@local", organization: null, role: "editor" as const, authType: "agent" as const },
  ];
  expect(filterManagedUsers(users, { query: "", role: "editor", authType: "all" }).map((u) => u.id)).toEqual(["1", "3"]);
  expect(filterManagedUsers(users, { query: "카메라", role: "all", authType: "all" }).map((u) => u.id)).toEqual(["1"]);
  expect(filterManagedUsers(users, { query: "", role: "editor", authType: "agent" }).map((u) => u.id)).toEqual(["3"]);
});

test("페이지 번호는 결과 수가 줄면 마지막 페이지로 당겨진다", () => {
  const items = Array.from({ length: 120 }, (_, index) => index);
  expect(pageOf(items, 1, 50)).toMatchObject({ page: 1, pages: 3 });
  expect(pageOf(items, 3, 50).items).toHaveLength(20);
  expect(pageOf(items.slice(0, 10), 3, 50)).toMatchObject({ page: 1, pages: 1 });
  expect(pageOf([], 1, 50)).toMatchObject({ page: 1, pages: 1, items: [] });
});

// 선택은 검색을 바꿔도 남는다. 화면 밖 선택을 세어 드러내지 않으면 일괄 변경이
// 보이지 않는 사람까지 조용히 바꾼다.
test("현재 목록에 없는 선택 수를 센다", () => {
  expect(hiddenSelectionCount(new Set(["a", "b", "c"]), ["a", "x"])).toBe(2);
  expect(hiddenSelectionCount(new Set(), ["a"])).toBe(0);
  const panel = read("src", "app", "admin", "users-panel.tsx");
  expect(panel).toContain("현재 목록 밖 {hiddenSelected}명 포함");
  expect(panel).toContain("현재 목록에 보이지 않는 ${hiddenSelected}명도 함께 바뀝니다.");
});

test("전체 재색인은 확인을 받고, 끝나면 색인 현황을 다시 읽는다", () => {
  const panel = read("src", "app", "admin", "rag-settings-panel.tsx");
  const reindex = panel.slice(panel.indexOf("async function reindex()"));
  expect(reindex.indexOf("window.confirm(")).toBeGreaterThan(-1);
  expect(reindex.indexOf("window.confirm(")).toBeLessThan(reindex.indexOf('fetch("/api/v1/admin/rag-config/reindex"'));
  expect(reindex).toContain("await refreshStats()");
});

// 텔레메트리의 작업 식별자를 새로 만들면 여기서 한글 이름이 빠졌는지 잡힌다.
test("AI 운영 화면은 코드에 있는 모든 작업 이름에 한글 라벨을 붙인다", () => {
  const operations = new Set<string>();
  for (const file of walk(path.join(root, "src", "lib"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/operation: "([a-z][a-z0-9_.:-]+)"/g)) operations.add(match[1]!);
  }
  expect(operations.size).toBeGreaterThan(10);
  for (const operation of operations) expect(operationLabel(operation), operation).not.toBe(operation);
  expect(operationLabel("agent.review.repair")).toBe("용어 자동 검토 (형식 보정)");
  expect(operationLabel("unknown.op")).toBe("unknown.op");
  expect(errorCodeLabel("rate_limited")).toBe("호출 한도 초과");
  expect(errorCodeLabel(null)).toBe("실패");
});

test("예전 동기화 탭 주소는 백업 · 동기화 탭으로 옮겨 준다", () => {
  const keys = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key as string));
  for (const [alias, target] of Object.entries(ADMIN_TAB_ALIASES)) {
    expect(keys, alias).not.toContain(alias);
    expect(keys).toContain(target);
  }
  expect(ADMIN_TAB_ALIASES.sync).toBe("data");
  const page = read("src", "app", "admin", "page.tsx");
  expect(page).toContain("if (alias) redirect(adminTabHref(alias))");
});

// 탭마다 제목 크기와 저장 영역이 제각각이던 것을 공통 컴포넌트로 묶었다.
// 새 탭이 손으로 머리말을 다시 그리면 화면이 다시 흔들린다.
test("관리자 탭은 공통 머리말을, 설정형 탭은 공통 저장 바를 쓴다", () => {
  const panels = [
    "admin-overview-panel.tsx",
    "users-panel.tsx",
    "home-content-panel.tsx",
    "brand-settings-panel.tsx",
    "menu-settings-panel.tsx",
    "term-quality-panel.tsx",
    "ai-settings-panel.tsx",
    "rag-settings-panel.tsx",
    "ai-observability-panel.tsx",
  ];
  for (const file of panels) {
    const source = readFileSync(path.join(adminDir, file), "utf8");
    expect(source, file).toContain("<AdminPanelHeader");
    expect(source, file).not.toMatch(/<h2[^>]*className="text-(base|lg|2xl)/);
  }
  for (const file of ["home-content-panel.tsx", "brand-settings-panel.tsx", "menu-settings-panel.tsx", "ai-settings-panel.tsx", "rag-settings-panel.tsx"]) {
    expect(readFileSync(path.join(adminDir, file), "utf8"), file).toContain("<AdminSaveBar");
  }
  const page = read("src", "app", "admin", "page.tsx");
  expect(page.match(/<AdminPanelHeader/g)?.length).toBe(2); // 백업 · 동기화, 로그인 방식
});

test("관리자 화면 문구에 영어 조작 라벨이 섞이지 않는다", () => {
  for (const file of readdirSync(adminDir)) {
    const source = readFileSync(path.join(adminDir, file), "utf8");
    // 화면에 그려지는 텍스트 노드만 본다(`setConnected` 같은 식별자는 제외).
    for (const word of ["Connected", "Custom headers", "+ Header", "Admin workspace"]) {
      expect(source, `${file}: ${word}`).not.toMatch(new RegExp(`(>|\\n)\\s*${word.replace(/[+]/g, "\\+")}\\s*(<|\\n)`));
    }
  }
});
