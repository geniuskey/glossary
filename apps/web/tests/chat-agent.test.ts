import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, terms, users, chatConversations } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { currentRevisionNumber } from "../src/lib/terms/update.js";
import { chatEditPatchSchema } from "../src/lib/ai/chat-edit-schema.js";

const complete = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/ai/provider", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/lib/ai/provider.js")>(), completeAi: complete }));
vi.mock("../src/lib/ai/config", () => ({ loadAiConfig: async () => ({ enabled: true }), runtimeAiConfig: () => ({}) }));
const identity = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: async () => identity.user }));
const { answerGlossaryQuestion } = await import("../src/lib/ai/chat.js");
const { POST: chat } = await import("../src/app/api/v1/chat/route.js");
const { POST: action } = await import("../src/app/api/v1/chat/actions/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  complete.mockReset();
  for (const id of ids.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
  identity.user = null;
});

async function seed() {
  const name = `Agent${randomUUID().replaceAll("-", "")}`;
  const { term } = await createTerm({ nameEn: name, definitionMd: "원래 정의", bodyMd: "삭제하면 안 되는 본문", domain: [], surfaces: [] }, null);
  ids.push(term.id);
  return term;
}

test("검색 실패는 등록으로 전환하지 않고 추가 맥락을 요청한다", async () => {
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "ask", query: `Unknown${randomUUID().replaceAll("-", "")}` }));
  const result = await answerGlossaryQuestion("이게 무슨 뜻이야?");
  expect(result.teaching).toBeUndefined();
  expect(result.edit).toBeUndefined();
  expect(result.answer).toContain("관련 근거를 찾지 못했습니다");
  expect(complete).toHaveBeenCalledTimes(1);
});

test("미등록 초안의 후속 수정에는 등록 맥락과 기존 분류를 유지한다", async () => {
  const draft = { nameEn: "NewAE", nameKo: null, fullNameEn: null, fullNameKo: null, definitionMd: "기존 초안", bodyMd: null, domain: ["ISP"], skipped: { fullName: true, definition: false, body: true } };
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "create", query: "NewAE" }))
    .mockResolvedValueOnce(JSON.stringify({ nameEn: "NewAE", nameKo: null, fullNameEn: null, fullNameKo: null, definitionMd: "고친 초안", bodyMd: null, skipped: draft.skipped }));
  const result = await answerGlossaryQuestion("정의를 고친 초안으로 바꿔줘", [], draft);
  expect(result.edit).toBeUndefined();
  expect(result.teaching?.draft).toMatchObject({ definitionMd: "고친 초안", domain: ["ISP"] });
  expect(complete.mock.calls[0]?.[1][0].content).toContain('PENDING_CREATION={"nameEn":"NewAE"');
});

test("수정 의도를 검색보다 먼저 분기하고 전체 원문을 바탕으로 제안만 만든다", async () => {
  const term = await seed();
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "edit", query: term.nameEn }))
    .mockResolvedValueOnce(JSON.stringify({ slug: term.slug, clarification: "" }))
    .mockResolvedValueOnce(JSON.stringify({ patch: { definitionMd: "새 정의" }, reason: "사용자의 정의 수정 요청" }));
  const result = await answerGlossaryQuestion(`${term.nameEn}의 정의를 새 정의로 수정해줘`);
  expect(result.edit).toMatchObject({ termId: term.id, expectedRevision: 1, before: { bodyMd: "삭제하면 안 되는 본문" }, patch: { definitionMd: "새 정의" }, status: "pending" });
  expect(await currentRevisionNumber(term.id)).toBe(1);
  expect(complete.mock.calls[2]?.[1][0].content).toContain("삭제하면 안 되는 본문");
});

test("후보에 없는 AI 생성 식별자는 수정 대상으로 사용하지 않는다", async () => {
  const term = await seed();
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "edit", query: term.nameEn }))
    .mockResolvedValueOnce(JSON.stringify({ slug: "invented-slug", clarification: "도메인을 알려주세요." }));
  const result = await answerGlossaryQuestion("정의를 수정해줘");
  expect(result.edit).toBeUndefined();
  expect(result.answer).toContain("도메인");
  expect(complete).toHaveBeenCalledTimes(2);
});

test("이름이 모호하면 사용자에게 선택을 요청한다", async () => {
  const term = await seed();
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "edit", query: term.nameEn }))
    .mockResolvedValueOnce(JSON.stringify({ slug: null, clarification: "어느 도메인의 용어인가요?" }));
  const result = await answerGlossaryQuestion("이 용어를 수정해줘");
  expect(result.edit).toBeUndefined();
  expect(result.answer).toContain("어느 도메인");
});

test("지원하지 않는 실행 요청과 잘못된 모델 응답으로 수정하지 않는다", async () => {
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "unsupported", query: "용어 삭제" }));
  expect((await answerGlossaryQuestion("용어를 삭제해줘")).edit).toBeUndefined();
  complete.mockResolvedValueOnce("잘못된 응답");
  expect((await answerGlossaryQuestion("수정해줘")).answer).toContain("해석하지 못했습니다");
  expect(chatEditPatchSchema.safeParse({ ownerId: randomUUID() }).success).toBe(false);
  expect(chatEditPatchSchema.safeParse({ status: "active" }).success).toBe(false);
  expect(chatEditPatchSchema.safeParse({}).success).toBe(false);
});

test("챗 API의 수정 요청부터 저장된 제안 적용까지 이어진다", async () => {
  const term = await seed();
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@agent.test`, name: "편집자", role: "editor" }).returning();
  identity.user = user!;
  userIds.push(user!.id);
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "edit", query: term.nameEn }))
    .mockResolvedValueOnce(JSON.stringify({ slug: term.slug, clarification: "" }))
    .mockResolvedValueOnce(JSON.stringify({ patch: { definitionMd: "API를 통한 새 정의" }, reason: "사용자가 요청한 변경" }));
  const response = await chat(new Request("https://glossary.example.com/api/v1/chat", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: `${term.nameEn} 정의를 API를 통한 새 정의로 수정해줘` }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.messages).toHaveLength(2);
  expect(body.messages[1].edit.id).toBe(body.edit.id);
  expect(await currentRevisionNumber(term.id)).toBe(1);
  const applied = await action(new Request("https://glossary.example.com/api/v1/chat/actions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: body.sessionId, actionId: body.edit.id, action: "apply" }),
  }));
  expect(applied.status).toBe(200);
  const [saved] = await db.select().from(chatConversations).where(eq(chatConversations.id, body.sessionId));
  expect(saved!.messages).toMatchObject([{ role: "user" }, { edit: { status: "applied", appliedRevision: 2 } }]);
});
