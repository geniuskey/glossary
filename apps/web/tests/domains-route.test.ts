import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, domains, terms, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { DOMAIN_COLOR_PALETTE } from "../src/lib/terms/domain-colors.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { POST } = await import("../src/app/api/v1/admin/domains/route.js");
const { PATCH, DELETE } = await import("../src/app/api/v1/admin/domains/[key]/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
let domainKey = "";
let domainLabel = "";
let termId = "";
const extraDomainKeys: string[] = [];

afterAll(async () => {
  if (termId) await db.delete(terms).where(eq(terms.id, termId));
  if (domainKey) await db.delete(domains).where(eq(domains.key, domainKey));
  for (const key of extraDomainKeys) await db.delete(domains).where(eq(domains.key, key));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `domain-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `${role} domain tester`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  userIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function jsonRequest(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/domains", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("일반 사용자는 분류 체계에 도메인을 추가하고 미사용 도메인을 삭제한다", async () => {
  await loginAs("editor");
  expect((await POST(jsonRequest("POST", {}))).status).toBe(400);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  domainLabel = `Domain ${suffix}`;
  const created = await POST(jsonRequest("POST", { label: domainLabel }));
  expect(created.status).toBe(201);
  const createdBody = await created.json();
  domainKey = createdBody.domain.key;
  expect(createdBody.domain.color).toMatch(/^p\d{2}$/);

  const unused = await POST(jsonRequest("POST", { label: `Unused ${suffix}` }));
  const unusedKey = (await unused.json()).domain.key as string;
  expect((await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: unusedKey }) })).status).toBe(204);
});

test("사용 중 도메인은 일반 사용자가 삭제할 수 없고 관리자 변경은 연결된 용어에 반영된다", async () => {
  const [term] = await db.insert(terms).values({
    slug: `domain-route-term-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nameEn: "Domain route fixture",
    domain: [domainLabel, "Other"],
  }).returning({ id: terms.id });
  termId = term!.id;

  const denied = await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: domainKey }) });
  expect(denied.status).toBe(403);

  await loginAs("admin");
  const renamedLabel = `${domainLabel} renamed`;
  expect((await PATCH(jsonRequest("PATCH", { label: renamedLabel }), { params: Promise.resolve({ key: domainKey }) })).status).toBe(200);
  let [updated] = await db.select({ domain: terms.domain }).from(terms).where(eq(terms.id, termId));
  expect(updated?.domain).toEqual([renamedLabel, "Other"]);

  const allColors = await db.select({ color: domains.color }).from(domains);
  const changedColor = DOMAIN_COLOR_PALETTE.find((color) => !allColors.some((row) => row.color === color.key))!.key;
  expect((await PATCH(jsonRequest("PATCH", { color: changedColor }), { params: Promise.resolve({ key: domainKey }) })).status).toBe(200);
  const [recolored] = await db.select({ color: domains.color }).from(domains).where(eq(domains.key, domainKey));
  expect(recolored?.color).toBe(changedColor);

  const extra = await POST(jsonRequest("POST", { label: `${domainLabel} color peer` }));
  expect(extra.status).toBe(201);
  const extraBody = await extra.json();
  extraDomainKeys.push(extraBody.domain.key);
  expect(extraBody.domain.color).not.toBe(changedColor);
  expect((await PATCH(jsonRequest("PATCH", { color: changedColor }), { params: Promise.resolve({ key: extraBody.domain.key }) })).status).toBe(409);
  expect((await PATCH(jsonRequest("PATCH", { color: "not-a-palette-color" }), { params: Promise.resolve({ key: extraBody.domain.key }) })).status).toBe(400);

  expect((await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: domainKey }) })).status).toBe(204);
  domainKey = "";
  [updated] = await db.select({ domain: terms.domain }).from(terms).where(eq(terms.id, termId));
  expect(updated?.domain).toEqual(["Other"]);
});
