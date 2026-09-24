import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, terms, users, wikiPages } from "@glossary/db";

const identity = vi.hoisted(() => ({ user: null as { id: string; role: "admin" | "editor" } | null }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: async () => identity.user }));
vi.mock("../src/lib/rag/wiki-indexer", () => ({
  queueWikiIndex: vi.fn(async () => undefined),
  scheduleWikiRagIndexing: vi.fn(),
}));

const { GET: listWiki, POST: createWiki } = await import("../src/app/api/v1/wiki/route.js");
const { GET: getWiki, PATCH: patchWiki } = await import("../src/app/api/v1/wiki/[slug]/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
let userId = "";
let termId = "";
let secondTermId = "";
const wikiIds: string[] = [];
const termSlug = `wiki-route-term-${randomUUID().slice(0, 8)}`;
const secondTermSlug = `wiki-route-second-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const [user] = await db.insert(users).values({
    email: `${randomUUID()}@wiki-route.test`,
    name: "위키 API 사용자",
    role: "editor",
  }).returning();
  userId = user!.id;
  identity.user = { id: userId, role: "editor" };

  const [term] = await db.insert(terms).values({
    slug: termSlug,
    nameEn: "Wiki Route Term",
    nameKo: "하늘",
    domain: ["QA"],
    status: "active",
  }).returning();
  termId = term!.id;
  const [secondTerm] = await db.insert(terms).values({
    slug: secondTermSlug,
    nameKo: "가나다",
    status: "active",
  }).returning();
  secondTermId = secondTerm!.id;
});

afterAll(async () => {
  for (const id of wikiIds) await db.delete(wikiPages).where(eq(wikiPages.id, id));
  if (termId) await db.delete(terms).where(eq(terms.id, termId));
  if (secondTermId) await db.delete(terms).where(eq(terms.id, secondTermId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  identity.user = null;
});

test("위키 API는 연결 용어와 함께 생성·조회·수정·검색을 제공한다", async () => {
  const slug = `wiki-route-${randomUUID().slice(0, 8)}`;
  const createdResponse = await createWiki(new Request("https://glossary.example.com/api/v1/wiki", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug,
      title: "상품 운영 위키",
      summary: "운영 기준",
      sourceUrl: "https://confluence.example.com/pages/123",
      content: "## 결정\n베타 운영을 진행한다.",
      domain: ["상품"],
      termSlugs: [termSlug, secondTermSlug],
      status: "draft",
    }),
  }));
  expect(createdResponse.status).toBe(201);
  const createdBody = await createdResponse.json() as { page: { id: string; slug: string; revision: number; content: string; status: string; terms: Array<{ slug: string; title: string }> } };
  wikiIds.push(createdBody.page.id);
  expect(createdBody.page).toMatchObject({ slug, revision: 1, sourceUrl: "https://confluence.example.com/pages/123", content: expect.stringContaining("베타"), status: "draft" });
  expect(createdBody.page.terms).toEqual([
    { id: expect.any(String), slug: secondTermSlug, title: "가나다", domain: [] },
    { id: expect.any(String), slug: termSlug, title: "하늘", domain: ["QA"] },
  ]);

  const listResponse = await listWiki(new Request(`https://glossary.example.com/api/v1/wiki?q=${slug}&status=draft`));
  expect(listResponse.status).toBe(200);
  await expect(listResponse.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: createdBody.page.id, slug, status: "draft" })] });

  const detailResponse = await getWiki(new Request(`https://glossary.example.com/api/v1/wiki/${slug}`), { params: Promise.resolve({ slug }) });
  expect(detailResponse.status).toBe(200);
  await expect(detailResponse.json()).resolves.toMatchObject({ page: { content: expect.stringContaining("베타"), terms: [expect.objectContaining({ slug: secondTermSlug }), expect.objectContaining({ slug: termSlug })] } });

  const editorPublishResponse = await patchWiki(new Request("https://glossary.example.com/api/v1/wiki/slug", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "## 결정\n베타 운영을 확정한다.", status: "published" }),
  }), { params: Promise.resolve({ slug }) });
  expect(editorPublishResponse.status).toBe(403);

  identity.user = { id: userId, role: "admin" };
  const updatedResponse = await patchWiki(new Request("https://glossary.example.com/api/v1/wiki/slug", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "## 결정\n베타 운영을 확정한다.", status: "published" }),
  }), { params: Promise.resolve({ slug }) });
  expect(updatedResponse.status).toBe(200);
  await expect(updatedResponse.json()).resolves.toMatchObject({ page: { revision: 2, status: "published", content: expect.stringContaining("확정") } });

  const publishedList = await listWiki(new Request("https://glossary.example.com/api/v1/wiki?status=published"));
  await expect(publishedList.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: createdBody.page.id, status: "published" })] });
});
