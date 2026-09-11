import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { chatConversations, createDb, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { currentRevisionNumber, listRevisions, updateTerm } from "../src/lib/terms/update.js";
import { getTermByIdOrSlug } from "../src/lib/terms/query.js";
import type { ChatEditProposal } from "../src/lib/ai/chat-edit-values.js";
import type { StoredChatMessage } from "../src/lib/ai/chat-history-values.js";
import { appendChatMessage } from "../src/lib/ai/chat-messages.js";

const identity = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: async () => identity.user }));
const { POST } = await import("../src/app/api/v1/chat/actions/route.js");
const { PATCH } = await import("../src/app/api/v1/chat/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
const termIds: string[] = [];

afterEach(async () => {
  identity.user = null;
  for (const id of termIds.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function seed() {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@chat.test`, name: "챗 편집자", role: "editor" }).returning();
  userIds.push(user!.id);
  identity.user = user!;
  const { term } = await createTerm({ nameEn: `Chat-${randomUUID()}`, definitionMd: "기존 정의", bodyMd: "기존 본문", domain: [], surfaces: [{ text: "유지할 별칭", lang: "ko", kind: "alias" }] }, user!.id);
  termIds.push(term.id);
  const edit: ChatEditProposal = {
    id: randomUUID(), termId: term.id, slug: term.slug, title: term.nameEn!, expectedRevision: 1,
    before: { definitionMd: "기존 정의" }, patch: { definitionMd: "수정된 정의" }, reason: "사용자가 정의 변경을 요청함", status: "pending",
  };
  const messages: StoredChatMessage[] = [{ id: 1, role: "assistant", content: "수정안", edit }];
  const [session] = await db.insert(chatConversations).values({ userId: user!.id, title: "수정 테스트", messages }).returning();
  return { term, edit, session: session!, messages };
}

function actionRequest(sessionId: string, actionId: string, action = "apply") {
  return new Request("https://glossary.example.com/api/v1/chat/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, actionId, action }) });
}

test("수정과 완료 기록을 저장하고 재시도해도 리비전을 중복 생성하지 않는다", async () => {
  const { term, edit, session } = await seed();
  const responses = await Promise.all([POST(actionRequest(session.id, edit.id)), POST(actionRequest(session.id, edit.id))]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(await currentRevisionNumber(term.id)).toBe(2);
  const saved = await getTermByIdOrSlug(term.id);
  expect(saved?.definitionMd).toBe("수정된 정의");
  expect(saved?.bodyMd).toBe("기존 본문");
  expect(saved?.surfaces.some((surface) => surface.text === "유지할 별칭")).toBe(true);
  const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.id, session.id));
  expect((conversation!.messages as StoredChatMessage[])[0]?.edit).toMatchObject({ status: "applied", appliedRevision: 2 });
  const [revision] = await listRevisions(term.id);
  expect(revision?.message).toContain(edit.id);
  expect(revision?.authorId).toBe(identity.user!.id);
});

test("다른 사용자의 최신 수정은 덮어쓰지 않는다", async () => {
  const { term, edit, session } = await seed();
  await updateTerm(term.id, { bodyMd: "다른 사람이 수정함" }, null, 1);
  const response = await POST(actionRequest(session.id, edit.id));
  expect(response.status).toBe(409);
  expect((await getTermByIdOrSlug(term.id))?.definitionMd).toBe("기존 정의");
  expect(await currentRevisionNumber(term.id)).toBe(2);
});

test("취소한 수정안과 타인 대화는 적용할 수 없다", async () => {
  const { term, edit, session } = await seed();
  const owner = identity.user;
  identity.user = null;
  expect((await POST(actionRequest(session.id, edit.id))).status).toBe(401);
  identity.user = { id: randomUUID(), role: "editor" };
  expect((await POST(actionRequest(session.id, edit.id))).status).toBe(404);
  identity.user = owner;
  expect((await POST(actionRequest(session.id, edit.id, "cancel"))).status).toBe(200);
  expect((await (await POST(actionRequest(session.id, edit.id))).json()).edit.status).toBe("cancelled");
  expect(await currentRevisionNumber(term.id)).toBe(1);
});

test("클라이언트 대화 저장으로 수정안·완료 기록을 위조하거나 되돌릴 수 없다", async () => {
  const { term, edit, session, messages } = await seed();
  await POST(actionRequest(session.id, edit.id));
  const response = await PATCH(new Request("https://glossary.example.com/api/v1/chat", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, messages: [{ ...messages[0], edit: { ...edit, patch: { definitionMd: "위조" } } }] }),
  }));
  expect(response.status).toBe(200);
  const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.id, session.id));
  expect((conversation!.messages as StoredChatMessage[])[0]?.edit).toMatchObject({ status: "applied", patch: { definitionMd: "수정된 정의" } });
  await POST(actionRequest(session.id, edit.id));
  expect(await currentRevisionNumber(term.id)).toBe(2);
});

test("완료 기록 저장이 실패하면 용어 수정과 리비전도 롤백된다", async () => {
  const { term } = await seed();
  await expect(updateTerm(term.id, { definitionMd: "반영되면 안 됨" }, identity.user!.id, 1, null, "chat:test", async () => { throw new Error("receipt failed"); })).rejects.toThrow("receipt failed");
  expect((await getTermByIdOrSlug(term.id))?.definitionMd).toBe("기존 정의");
  expect(await currentRevisionNumber(term.id)).toBe(1);
});

test("후속 수정안이 이전 수정안을 대체하고 동시 메시지가 유실되지 않는다", async () => {
  const { edit, session } = await seed();
  await Promise.all([
    appendChatMessage(session.id, identity.user!.id, { role: "user", content: "다음 질문" }),
    appendChatMessage(session.id, identity.user!.id, { role: "assistant", content: "새 수정안", edit: { ...edit, id: randomUUID() } }),
  ]);
  const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.id, session.id));
  const messages = conversation!.messages as StoredChatMessage[];
  expect(messages).toHaveLength(3);
  expect(new Set(messages.map((message) => message.id)).size).toBe(3);
  expect(messages[0]?.edit?.status).toBe("cancelled");
});
