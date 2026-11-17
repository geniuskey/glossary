import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { createDb, notifications, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { mergeTerms } from "../src/lib/terms/merge.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { commentExcerpt } from "../src/lib/notifications/store.js";
import { NOTIFICATION_PHRASE, unreadBadgeLabel } from "../src/components/notification-menu.js";
import { desiredCommentNotifications } from "../src/lib/notifications/wire.js";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && cookie ? { name, value: cookie } : undefined }) }));
const { POST: postComment } = await import("../src/app/api/v1/terms/[idOrSlug]/comments/route.js");
const { PATCH: patchComment, DELETE: deleteComment } = await import("../src/app/api/v1/terms/[idOrSlug]/comments/[commentId]/route.js");
const { GET: listNotifications } = await import("../src/app/api/v1/notifications/route.js");
const { POST: markRead } = await import("../src/app/api/v1/notifications/read/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const termIds: string[] = [], userIds: string[] = [];
afterEach(() => { cookie = undefined; });
afterAll(async () => {
  for (const id of termIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
});

async function user(name: string) {
  const [row] = await db.insert(users).values({ email: `${randomUUID()}@example.test`, name, role: "editor", passwordHash: "unused" }).returning();
  userIds.push(row!.id);
  return row!;
}
async function term() {
  const created = await createTerm({ nameEn: `Notify${randomUUID().replaceAll("-", "")}`, domain: ["QA"], surfaces: [] }, null);
  termIds.push(created.term.id);
  return created.term;
}
async function as(id: string) { cookie = (await createSession(id)).token; }
const req = (method: string, body?: unknown) => new Request("http://localhost/api/v1/x", { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const p = (idOrSlug: string) => ({ params: Promise.resolve({ idOrSlug }) });
const pc = (idOrSlug: string, commentId: string) => ({ params: Promise.resolve({ idOrSlug, commentId }) });
const mention = (u: { id: string; name: string }) => `@[${u.name}](user:${u.id})`;
async function inbox(id: string) { await as(id); return (await listNotifications(req("GET"))).json(); }

test("멘션된 사람에게만 알림이 가고, 자기 자신·고친 댓글은 알림을 다시 만들지 않는다", async () => {
  const t = await term();
  const author = await user("작성자"), a = await user("받는 사람"), b = await user("구경꾼");
  await as(author.id);
  const { comment } = await (await postComment(req("POST", { body: `${mention(a)} ${mention(author)} 이 정의 맞나요?` }), p(t.slug))).json();

  const got = await inbox(a.id);
  expect(got.unreadCount).toBe(1);
  expect(got.items[0]).toMatchObject({
    kind: "comment_mention", read: false, actorName: "작성자",
    excerpt: "@받는 사람 @작성자 이 정의 맞나요?", term: { slug: t.slug }, href: `/g/${t.slug}#comment-${comment.id}`,
  });
  expect((await inbox(author.id)).unreadCount).toBe(0);
  expect((await inbox(b.id)).unreadCount).toBe(0);

  // 읽은 뒤 오탈자만 고쳐도 다시 "안 읽음"이 되지 않는다.
  await as(a.id);
  expect(await (await markRead(req("POST", { ids: [got.items[0].id] }))).json()).toEqual({ updated: 1 });
  await as(author.id);
  await patchComment(req("PATCH", { body: `${mention(a)} 이 정의가 맞나요?` }), pc(t.slug, comment.id));
  expect((await inbox(a.id)).unreadCount).toBe(0);
  expect((await inbox(a.id)).items[0].excerpt).toBe("@받는 사람 이 정의가 맞나요?");

  // 수정으로 b를 새로 넣고 a를 빼면 알림도 그대로 따라간다.
  await as(author.id);
  await patchComment(req("PATCH", { body: `${mention(b)} 대신 봐 주세요` }), pc(t.slug, comment.id));
  expect((await inbox(a.id)).items).toHaveLength(0);
  expect((await inbox(b.id)).unreadCount).toBe(1);

  await as(author.id);
  await deleteComment(req("DELETE"), pc(t.slug, comment.id));
  expect((await inbox(b.id)).items).toHaveLength(0);
});

test("모두 읽음은 내 알림만 바꾸고, 빈 ids는 아무것도 바꾸지 않는다", async () => {
  const t = await term();
  const author = await user("작성자"), a = await user("A"), b = await user("B");
  await as(author.id);
  await postComment(req("POST", { body: `${mention(a)} ${mention(b)} 확인` }), p(t.slug));
  await postComment(req("POST", { body: `${mention(a)} 하나 더` }), p(t.slug));

  await as(a.id);
  expect(await (await markRead(req("POST", { ids: [] }))).json()).toEqual({ updated: 0 });
  expect(await (await markRead(req("POST", {}))).json()).toEqual({ updated: 2 });
  expect((await inbox(a.id)).unreadCount).toBe(0);
  expect((await inbox(b.id)).unreadCount).toBe(1);
});

test("알림은 로그인한 사람만 읽는다", async () => {
  expect((await listNotifications(req("GET"))).status).toBe(401);
  expect((await markRead(req("POST", {}))).status).toBe(401);
});

test("병합하면 알림 링크도 병합 대상 용어를 가리킨다", async () => {
  const [source, target] = [await term(), await term()];
  const author = await user("작성자"), a = await user("A");
  await as(author.id);
  await postComment(req("POST", { body: `${mention(a)} 원본에서` }), p(source.slug));
  await mergeTerms(source.id, target.id, 1, 1, author.id, null);
  const rows = await db.select().from(notifications).where(eq(notifications.userId, a.id));
  expect(rows.map((r) => r.termId)).toEqual([target.id]);
  expect((await inbox(a.id)).items[0].href).toMatch(new RegExp(`^/g/${target.slug}#comment-`));
});

test("알림 발췌는 멘션 토큰을 이름으로 풀고 길면 자른다", () => {
  expect(commentExcerpt(`안녕\n\n  ${mention({ id: randomUUID(), name: "김민수" })}`)).toBe("안녕 @김민수");
  expect(commentExcerpt("가".repeat(200))).toHaveLength(120);
  expect(unreadBadgeLabel(7)).toBe("7");
  expect(unreadBadgeLabel(150)).toBe("99+");
});

test("답글을 달면 원 댓글 작성자에게 알림이 가고, 멘션과는 겹치지 않는다", async () => {
  const t = await term();
  const op = await user("원글 작성자"), replier = await user("답글 작성자"), other = await user("제3자");
  await as(op.id);
  const { comment: root } = await (await postComment(req("POST", { body: "이 용어 정의가 애매합니다" }), p(t.slug))).json();

  // 멘션 없이 답글 → 원글 작성자에게 답글 알림
  await as(replier.id);
  const { comment: plain } = await (await postComment(req("POST", { body: "동의합니다", parentId: root.id }), p(t.slug))).json();
  let got = await inbox(op.id);
  expect(got.items).toHaveLength(1);
  expect(got.items[0]).toMatchObject({ kind: "comment_reply", actorName: "답글 작성자", href: `/g/${t.slug}#comment-${plain.id}` });

  // 원글 작성자를 멘션한 답글 → 멘션 알림 하나만
  await as(replier.id);
  const { comment: mentioned } = await (await postComment(req("POST", { body: `${mention(op)} ${mention(other)} 보세요`, parentId: root.id }), p(t.slug))).json();
  got = await inbox(op.id);
  expect(got.items.filter((i: { href: string }) => i.href.endsWith(mentioned.id)).map((i: { kind: string }) => i.kind)).toEqual(["comment_mention"]);
  expect((await inbox(other.id)).items.map((i: { kind: string }) => i.kind)).toEqual(["comment_mention"]);

  // 읽은 뒤 멘션을 지우면 답글 알림으로 바뀌되 읽음 상태는 이어진다.
  await as(op.id);
  await markRead(req("POST", {}));
  await as(replier.id);
  await patchComment(req("PATCH", { body: "보세요" }), pc(t.slug, mentioned.id));
  got = await inbox(op.id);
  expect(got.items.find((i: { href: string }) => i.href.endsWith(mentioned.id))).toMatchObject({ kind: "comment_reply", read: true });
  expect(got.unreadCount).toBe(0);
  expect((await inbox(other.id)).items).toHaveLength(0);

  // 자기 댓글에 자기가 답글을 달면 알림이 없다.
  await as(op.id);
  await postComment(req("POST", { body: "보충합니다", parentId: root.id }), p(t.slug));
  expect((await inbox(op.id)).items).toHaveLength(2);
});

test("알림 대상 계산: 한 사람에게 하나, 멘션 우선, 자기 자신 제외", () => {
  const [me, op, x] = [randomUUID(), randomUUID(), randomUUID()];
  expect(desiredCommentNotifications({ actorId: me, mentionedUserIds: [op, x, me], parentAuthorId: op })).toEqual([
    { userId: op, kind: "comment_mention" }, { userId: x, kind: "comment_mention" },
  ]);
  expect(desiredCommentNotifications({ actorId: me, mentionedUserIds: [], parentAuthorId: op })).toEqual([{ userId: op, kind: "comment_reply" }]);
  expect(desiredCommentNotifications({ actorId: me, mentionedUserIds: [], parentAuthorId: me })).toEqual([]);
  expect(desiredCommentNotifications({ actorId: me, mentionedUserIds: [], parentAuthorId: null })).toEqual([]);
  expect(`용어${NOTIFICATION_PHRASE.comment_reply}`).toBe("용어에서 회원님의 댓글에 답글을 달았습니다.");
});
