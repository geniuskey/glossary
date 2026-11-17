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
const { GET: getChat, PATCH: patchChat } = await import("../src/app/api/v1/chat/route.js");
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

test("마지막 AI 호출이 끝난 직후 중단돼도 답을 돌려주지 않고 중단으로 끝낸다", async () => {
  const { ChatAbortedError } = await import("../src/lib/ai/chat-trace.js");
  const abort = new AbortController();
  complete.mockImplementationOnce(async () => {
    abort.abort();
    return JSON.stringify({ intent: "create", query: "새 용어" });
  }).mockResolvedValue(JSON.stringify({ answer: "등록 초안", draft: null, ready: false }));
  await expect(answerGlossaryQuestion("새 용어 등록해줘", [], null, null, undefined, undefined, { signal: abort.signal })).rejects.toBeInstanceOf(ChatAbortedError);
});

test("AI 호출 도중 중단되면 AbortError가 아니라 ChatAbortedError로 올라온다", async () => {
  const { ChatAbortedError } = await import("../src/lib/ai/chat-trace.js");
  const abort = new AbortController();
  complete.mockImplementationOnce(async (_config: unknown, _messages: unknown, _max: unknown, options: { context?: { signal?: AbortSignal } }) => {
    expect(options.context?.signal).toBe(abort.signal);
    abort.abort();
    throw new DOMException("Aborted", "AbortError");
  });
  const error = await answerGlossaryQuestion("AE가 뭐야?", [], null, null, undefined, undefined, { signal: abort.signal }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ChatAbortedError);
  expect((error as { trace?: Array<{ status: string }> }).trace?.at(-1)?.status).toBe("failed");
});

test("검색 실패는 등록으로 전환하지 않고 추가 맥락을 요청한다", async () => {
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "ask", query: `Unknown${randomUUID().replaceAll("-", "")}` }));
  const result = await answerGlossaryQuestion("이게 무슨 뜻이야?");
  expect(result.teaching).toBeUndefined();
  expect(result.edit).toBeUndefined();
  expect(result.answer).toContain("관련 근거를 찾지 못했습니다");
  // 계획을 읽지 못해도 원 질문으로 한 번 더 찾은 뒤 멈춘다. 등록 초안을 만드는 호출은 없다.
  expect(complete.mock.calls.map((call) => call[3]?.context?.operation)).toEqual(["chat.intent", "chat.research.plan", "chat.research.plan"]);
  expect(result.grounded?.searchedQueries).toEqual([expect.stringMatching(/^Unknown/), "이게 무슨 뜻이야?"]);
  expect(result.trace?.filter((step) => step.kind === "search").map((step) => step.resultCount)).toEqual([0, 0]);
  expect(result.trace?.every((step) => step.status === "done")).toBe(true);
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

test("근거 답변은 대화 재조회 시 복원되며 클라이언트가 구절과 답변을 위조할 수 없다", async () => {
  const term = await seed();
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@grounding.test`, name: "질문자", role: "editor" }).returning();
  identity.user = user!;
  userIds.push(user!.id);
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "ask", query: term.nameEn }))
    .mockResolvedValueOnce(JSON.stringify({ done: true, thought: "정의 근거를 찾았습니다.", searches: [] }))
    .mockImplementationOnce(async (_config, messages) => {
      const evidence = JSON.parse(messages[0].content.split("EVIDENCE=")[1]) as Array<{ id: string; slug: string; field: string }>;
      const definition = evidence.find((item) => item.slug === term.slug && item.field === "definition")!;
      return JSON.stringify({ claims: [{ text: "이 용어는 원래 정의를 뜻합니다.", evidenceIds: [definition.id] }], uncertainties: [], followUpQuery: null });
    });
  const response = await chat(new Request("https://glossary.example.com/api/v1/chat", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: `${term.nameEn} 뜻?`, domain: null }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.grounded.evidence[0]).toMatchObject({ revision: 1, excerpt: "원래 정의" });
  expect(body.trace.map((step: { kind: string }) => step.kind)).toEqual(["task", "search", "plan", "answer"]);
  const tampered = body.messages.map((message: { role: string }) => message.role === "assistant" ? { ...message, content: "위조한 답변", grounded: { claims: [], evidence: [] }, sources: [], trace: [] } : message);
  expect((await patchChat(new Request("https://glossary.example.com/api/v1/chat", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: body.sessionId, messages: tampered }) }))).status).toBe(200);
  const restored = await (await getChat(new Request(`https://glossary.example.com/api/v1/chat?session=${body.sessionId}`))).json();
  expect(restored.conversation.messages[1].grounded).toEqual(body.grounded);
  expect(restored.conversation.messages[1].content).toBe(body.answer);
  expect(restored.conversation.messages[1].trace).toEqual(body.trace);
});
