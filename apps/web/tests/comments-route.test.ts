import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, termComments, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { mergeTerms } from "../src/lib/terms/merge.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { generateApiKey } from "../src/lib/auth/api-key.js";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && cookie ? { name, value: cookie } : undefined }) }));
const { GET, POST } = await import("../src/app/api/v1/terms/[idOrSlug]/comments/route.js");
const { PATCH, DELETE } = await import("../src/app/api/v1/terms/[idOrSlug]/comments/[commentId]/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const termIds: string[] = [], userIds: string[] = [], keyIds: string[] = [];
afterEach(() => { cookie = undefined; });
afterAll(async () => {
  for (const id of termIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  for (const id of keyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

async function user(name: string, role: "admin" | "editor" | "viewer" = "editor") {
  const [row] = await db.insert(users).values({ email: `${randomUUID()}@example.test`, name, role, passwordHash: "unused" }).returning();
  userIds.push(row!.id);
  return row!;
}
async function term() {
  const created = await createTerm({ nameEn: `Comment${randomUUID().replaceAll("-", "")}`, domain: ["QA"], surfaces: [] }, null);
  termIds.push(created.term.id);
  return created.term;
}
async function as(id: string) { cookie = (await createSession(id)).token; }
function req(method: string, body?: unknown, token?: string) {
  return new Request("http://localhost/api/v1/terms/x/comments", { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const p = (idOrSlug: string) => ({ params: Promise.resolve({ idOrSlug }) });
const pc = (idOrSlug: string, commentId: string) => ({ params: Promise.resolve({ idOrSlug, commentId }) });

test("댓글·답글·멘션: 조회자도 쓸 수 있고 멘션 색인에는 실제 사용자만 남는다", async () => {
  const t = await term();
  const viewer = await user("조회자", "viewer"), mentioned = await user("멘션 대상");
  await as(viewer.id);
  const ghost = randomUUID();
  const created = await POST(req("POST", { body: `@[멘션 대상](user:${mentioned.id}) @[유령](user:${ghost}) 확인 부탁` }), p(t.slug));
  expect(created.status).toBe(201);
  const { comment } = await created.json();
  expect(comment).toMatchObject({ authorId: viewer.id, authorName: "조회자", mentionedUserIds: [mentioned.id], edited: false, parentId: null });

  const reply = await POST(req("POST", { body: "답글", parentId: comment.id }), p(t.slug));
  expect(reply.status).toBe(201);
  const nested = await POST(req("POST", { body: "답글의 답글", parentId: (await reply.json()).comment.id }), p(t.slug));
  expect(nested.status).toBe(201);

  const listed = await (await GET(req("GET"), p(t.id))).json();
  expect(listed.comments.map((c: { body: string }) => c.body)).toEqual([comment.body, "답글", "답글의 답글"]);
});

test("다른 용어의 댓글에는 답글을 달 수 없다", async () => {
  const [a, b] = [await term(), await term()];
  const u = await user("작성자");
  await as(u.id);
  const { comment } = await (await POST(req("POST", { body: "A의 댓글" }), p(a.slug))).json();
  expect((await POST(req("POST", { body: "엉뚱한 답글", parentId: comment.id }), p(b.slug))).status).toBe(404);
});

test("수정은 작성자만, 삭제는 작성자나 관리자만 — 삭제해도 답글은 남는다", async () => {
  const t = await term();
  const author = await user("작성자"), other = await user("다른 사람"), admin = await user("관리자", "admin");
  await as(author.id);
  const { comment } = await (await POST(req("POST", { body: "원글" }), p(t.slug))).json();
  await POST(req("POST", { body: "답글", parentId: comment.id }), p(t.slug));

  await as(other.id);
  expect((await PATCH(req("PATCH", { body: "변조" }), pc(t.slug, comment.id))).status).toBe(403);
  expect((await DELETE(req("DELETE"), pc(t.slug, comment.id))).status).toBe(403);

  await as(admin.id);
  expect((await PATCH(req("PATCH", { body: "관리자 변조" }), pc(t.slug, comment.id))).status).toBe(403);

  await as(author.id);
  const edited = await (await PATCH(req("PATCH", { body: "고친 원글" }), pc(t.slug, comment.id))).json();
  expect(edited.comment).toMatchObject({ body: "고친 원글", edited: true });

  await as(admin.id);
  const deleted = await (await DELETE(req("DELETE"), pc(t.slug, comment.id))).json();
  expect(deleted.comment).toMatchObject({ deleted: true, body: "", authorId: null });
  const listed = await (await GET(req("GET"), p(t.slug))).json();
  expect(listed.comments).toHaveLength(2);
  expect((await POST(req("POST", { body: "삭제된 글에 답글", parentId: comment.id }), p(t.slug))).status).toBe(400);
});

test("API 키는 읽기만 되고 댓글은 쓰지 못한다; 인증 없이는 401", async () => {
  const t = await term();
  expect((await GET(req("GET"), p(t.slug))).status).toBe(401);
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db.insert(apiKeys).values({ name: "댓글 테스트", prefix, keyHash: hash, scopes: ["read", "write"] }).returning();
  keyIds.push(key!.id);
  expect((await GET(req("GET", undefined, token), p(t.slug))).status).toBe(200);
  expect((await POST(req("POST", { body: "키로 쓰기" }, token), p(t.slug))).status).toBe(403);
});

test("빈 본문과 잘못된 id는 거절한다", async () => {
  const t = await term();
  const u = await user("작성자");
  await as(u.id);
  expect((await POST(req("POST", { body: "   " }), p(t.slug))).status).toBe(400);
  expect((await PATCH(req("PATCH", { body: "x" }), pc(t.slug, "not-a-uuid"))).status).toBe(404);
  expect((await GET(req("GET"), p("no-such-term-slug"))).status).toBe(404);
});

test("용어를 병합하면 댓글이 병합 대상으로 옮겨 간다", async () => {
  const [source, target] = [await term(), await term()];
  const u = await user("작성자");
  await as(u.id);
  await POST(req("POST", { body: "원본의 토론" }), p(source.slug));
  await mergeTerms(source.id, target.id, 1, 1, u.id, null);
  const rows = await db.select().from(termComments).where(eq(termComments.termId, target.id));
  expect(rows.map((r) => r.body)).toEqual(["원본의 토론"]);
});
