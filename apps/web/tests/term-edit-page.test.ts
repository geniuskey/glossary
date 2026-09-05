import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { createDb, terms, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";

// R109: EditTermPage(app/edit/[slug]/page.tsx)는 Server Component라
// jsdom 없이도(R97) 그냥 async 함수로 직접 호출할 수 있다 — JSX는 React
// 엘리먼트를 만드는 순수한 React.createElement 호출일 뿐이라, 렌더링(DOM
// 반영)을 하지 않는 한 자식 컴포넌트의 함수 본문(TermForm의 훅 등)은 전혀
// 실행되지 않는다. 그래서 반환된 엘리먼트 트리를 그냥 순회해서 TermForm에
// 넘어간 props.initial.expectedRevision을 직접 확인할 수 있다 — "use client"
// 컴포넌트를 렌더링하지 않고도, Server Component가 올바른 props를 계산해서
// 넘기는지는 검증 가능하다(현재-사용자 테스트와 같은 next/headers 모킹 패턴).
let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { default: EditTermPage } = await import("../src/app/edit/[slug]/page.js");
const { TermForm } = await import("../src/components/term-form.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const createdTermIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(role: "admin" | "editor" = "editor") {
  const [row] = await db
    .insert(users)
    .values({
      email: `term-edit-page-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "편집 페이지 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
      role,
    })
    .returning();
  createdUserIds.push(row!.id);
  return row!;
}

async function loginAs(userId: string) {
  const { token } = await createSession(userId);
  currentCookieValue = token;
}

// 반환된 React 엘리먼트 트리를 순회해서 지정한 컴포넌트 함수를 쓴 첫 엘리먼트를
// 찾는다. children은 배열이거나 단일 엘리먼트이거나 문자열/숫자/null일 수 있다.
function findElement(node: unknown, type: unknown): ReactElement | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el;
  if (el.props && "children" in el.props) return findElement(el.props.children, type);
  return null;
}

afterEach(async () => {
  for (const id of createdTermIds.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
  currentCookieValue = undefined;
});

test("편집 페이지는 현재 리비전 번호를 expectedRevision으로 TermForm에 넘긴다 (R109)", async () => {
  const user = await makeUser();
  await loginAs(user.id);

  const { term } = await createTerm(
    { nameEn: "Edit Page Probe", domain: [], status: "active", surfaces: [] },
    user.id,
  );
  createdTermIds.push(term.id);

  // 생성 후 두 번 더 patch해서 리비전을 3으로 만든다 — expectedRevision이
  // 하드코딩된 0이나 1이어도 우연히 맞아떨어지지 않도록 한다.
  await updateTerm(term.id, { nameKo: "편집 페이지 테스트" }, user.id);
  await updateTerm(term.id, { status: "deprecated" }, user.id);

  const element = await EditTermPage({ params: Promise.resolve({ slug: term.slug }) });
  const formElement = findElement(element, TermForm);
  expect(formElement, "TermForm 엘리먼트를 찾지 못함").not.toBeNull();

  const initial = (formElement!.props as { initial?: { expectedRevision?: number; slug?: string } }).initial;
  expect(initial?.expectedRevision).toBe(3);
  expect(initial?.slug).toBe(term.slug);
});

// R110의 반대편 절반: 편집 폼 초기값의 surfaces는 파생 가능한 표기(예: canonical
// 이름)를 빼고 명시 표기만 담아야 한다 — 이 페이지가 pickExplicitSurfaces 대신
// term.surfaces를 그대로 넘기면(예전 스케치처럼), 파생 canonical 표기가 폼에
// "명시 표기"인 것처럼 다시 나타나고 그대로 저장하면 영구히 명시 표기로 굳는다.
test("편집 페이지 초기값의 surfaces에는 파생 가능한 canonical 표기가 없다 (R110)", async () => {
  const user = await makeUser();
  await loginAs(user.id);

  const { term } = await createTerm(
    {
      nameEn: "Edit Surfaces Probe",
      domain: [],
      status: "active",
      surfaces: [{ text: "ESP-alias", lang: "en", kind: "alias" }],
    },
    user.id,
  );
  createdTermIds.push(term.id);

  const element = await EditTermPage({ params: Promise.resolve({ slug: term.slug }) });
  const formElement = findElement(element, TermForm);
  const initial = (formElement!.props as { initial?: { surfaces?: { text: string; kind: string }[] } }).initial;

  const texts = initial?.surfaces?.map((s) => s.text) ?? [];
  expect(texts).not.toContain("Edit Surfaces Probe"); // canonical, 파생 가능 -> 빠져야 함
  expect(texts).toContain("ESP-alias"); // 명시 표기 -> 남아야 함
});

test("관리자에게만 편집 폼의 삭제 권한을 넘긴다", async () => {
  const admin = await makeUser("admin");
  await loginAs(admin.id);
  const { term } = await createTerm(
    { nameEn: "Delete Button Probe", domain: [], status: "active", surfaces: [] },
    admin.id,
  );
  createdTermIds.push(term.id);

  const element = await EditTermPage({ params: Promise.resolve({ slug: term.slug }) });
  const formElement = findElement(element, TermForm);

  expect((formElement!.props as { canDelete?: boolean }).canDelete).toBe(true);
});
