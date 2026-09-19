import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { chatConversations, createDb, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";

const complete = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/ai/provider", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/lib/ai/provider.js")>(), completeAi: complete }));
vi.mock("../src/lib/ai/config", () => ({ loadAiConfig: async () => ({ enabled: true }), runtimeAiConfig: () => ({}) }));
const identity = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: async () => identity.user }));
const { answerGlossaryQuestion } = await import("../src/lib/ai/chat.js");
const { looksLikeMeetingRequest, splitMeetingEvidence, validateMeetingAnalysis } = await import("../src/lib/ai/meeting.js");
const { PATCH, GET } = await import("../src/app/api/v1/chat/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  complete.mockReset();
  identity.user = null;
  for (const id of ids.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

test("회의록 근거를 보존하고 용어집 RAG 근거를 별도로 연결한다", async () => {
  const { term } = await createTerm({
    nameEn: `Settlement${randomUUID().replaceAll("-", "")}`,
    definitionMd: "해외 정산 예외를 검토하는 조직 용어",
    bodyMd: "정산 담당자가 예외 건을 확인한다.",
    domain: ["QA"],
    surfaces: [],
  }, null);
  ids.push(term.id);

  complete.mockResolvedValueOnce(JSON.stringify({ intent: "meeting", query: "회의록 분석" }))
    .mockImplementationOnce(async (_config: unknown, messages: Array<{ role: string; content: string }>) => {
      const system = messages[0]!.content;
      const meetingEvidence = JSON.parse(system.split("MEETING_EVIDENCE=")[1]!.split("\n")[0]!) as Array<{ id: string; excerpt: string }>;
      const decision = meetingEvidence.find((item) => item.excerpt.includes("결정:"))!;
      const glossaryEvidence = JSON.parse(system.split("GLOSSARY_EVIDENCE=")[1]!.split("\n")[0]!) as Array<{ id: string }>;
      const definition = glossaryEvidence.find((item) => item.id.includes(":definition:"))!;
      return JSON.stringify({
        summary: { text: "해외 정산 예외 처리 방향을 결정했다.", evidenceIds: [decision.id] },
        topics: [{ text: "정산 예외", evidenceIds: [decision.id] }],
        decisions: [{ text: "예외 건을 담당자가 검토한다.", evidenceIds: [decision.id] }],
        actionItems: [{ text: "예외 목록을 확인한다.", evidenceIds: [decision.id], owner: "민지", dueDate: "금요일", status: "open" }],
        risks: [],
        openQuestions: [],
        insights: [{ title: "용어와 회의 맥락 연결", text: "회의의 예외 논의가 용어집 정의와 연결된다.", kind: "observation", confidence: "medium", discussionQuestion: null, evidenceIds: [definition.id] }],
        termMatches: [{ slug: term.slug, reason: "회의의 정산 예외를 설명하는 용어집 항목", evidenceIds: [definition.id] }],
        termCandidates: [],
        uncertainties: [],
      });
    });

  const result = await answerGlossaryQuestion("회의록을 요약해줘\n결정: 해외 정산 예외를 담당자가 검토한다.", [], null, null, "QA");
  expect(result.meeting).toMatchObject({
    summary: { text: "해외 정산 예외 처리 방향을 결정했다." },
    actionItems: [{ owner: "민지", status: "open" }],
    termMatches: [{ slug: term.slug, title: term.nameEn }],
  });
  expect(result.meeting?.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "meeting:1", source: "meeting", excerpt: expect.stringContaining("결정:") }),
    expect.objectContaining({ id: expect.stringMatching(/^glossary:/), source: "glossary", field: "definition" }),
  ]));
  expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ slug: term.slug })]));
  expect(result.answer).toContain("도메인 인사이트");
});

test("회의록 evidence는 원문 오프셋을 유지하고 모델이 만든 근거 ID를 검증한다", () => {
  expect(looksLikeMeetingRequest("회의 내용을 요약하고 결정 사항을 정리해줘")).toBe(true);
  expect(looksLikeMeetingRequest("회의라는 용어의 정의가 뭐야?")).toBe(false);
  const input = "회의록 요약 요청\n\n결정: A를 진행한다.\n담당: 민수";
  const evidence = splitMeetingEvidence(input);
  expect(evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "meeting:1", start: 0 }),
    expect.objectContaining({ excerpt: expect.stringContaining("결정:") }),
  ]));
  const invalid = validateMeetingAnalysis({
    summary: { text: "근거 없는 내용", evidenceIds: ["meeting:999"] },
    topics: [], decisions: [], actionItems: [], risks: [], openQuestions: [], insights: [], termMatches: [], termCandidates: [], uncertainties: [],
  }, evidence, { context: "{}", sources: [], evidence: [] });
  expect(invalid).toBeNull();
});

test("일반 용어 질문도 근거 기반 인사이트와 토론 질문을 반환할 수 있다", async () => {
  const { term } = await createTerm({
    nameEn: `Tradeoff${randomUUID().replaceAll("-", "")}`,
    definitionMd: "두 팀의 표준화 판단을 비교하는 용어",
    domain: ["QA"],
    surfaces: [],
  }, null);
  ids.push(term.id);
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "ask", query: term.nameEn }))
    .mockImplementationOnce(async (_config: unknown, messages: Array<{ role: string; content: string }>) => {
      const evidence = JSON.parse(messages[0]!.content.split("EVIDENCE=")[1]!) as Array<{ id: string; field: string }>;
      const definition = evidence.find((item) => item.field === "definition")!;
      return JSON.stringify({
        claims: [{ text: "조직 내 비교 기준을 설명하는 용어입니다.", evidenceIds: [definition.id] }],
        insights: [{ title: "표준화 논점", text: "두 팀이 같은 기준을 공유할지 확인할 필요가 있습니다.", evidenceIds: [definition.id], confidence: "medium", discussionQuestion: "공통 기준으로 합의할까요?" }],
        uncertainties: [],
        followUpQuery: null,
      });
    });
  const result = await answerGlossaryQuestion(`${term.nameEn}을 어떻게 표준화할지 논의해줘`);
  expect(result.grounded?.insights).toEqual([expect.objectContaining({ title: "표준화 논점", confidence: "medium" })]);
  expect(result.answer).toContain("도메인 관점");
  expect(result.answer).toContain("공통 기준으로 합의할까요?");
});

test("근거 연결을 복구하지 못하면 회의 분석을 생성하지 않는다", async () => {
  complete.mockResolvedValueOnce(JSON.stringify({ intent: "meeting", query: "회의록 분석" }))
    .mockResolvedValueOnce(JSON.stringify({ summary: { text: "조작", evidenceIds: ["invented"] } }))
    .mockResolvedValueOnce(JSON.stringify({ summary: { text: "조작", evidenceIds: ["invented"] } }));
  const result = await answerGlossaryQuestion("회의록을 분석해줘\n결정: 근거를 확인한다.");
  expect(result.meeting).toBeUndefined();
  expect(result.answer).toContain("근거 연결에 실패");
});

test("저장된 회의 분석의 원문과 구조화 근거는 클라이언트가 덮어쓸 수 없다", async () => {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@meeting.test`, name: "회의 사용자", role: "editor" }).returning();
  identity.user = { id: user!.id, role: user!.role };
  userIds.push(user!.id);
  const originalMeeting = {
    summary: { text: "서버가 보관한 요약", evidenceIds: ["meeting:1"] },
    evidence: [{ id: "meeting:1", source: "meeting", excerpt: "원문" }],
  };
  const [conversation] = await db.insert(chatConversations).values({
    userId: user!.id,
    title: "회의 분석",
    messages: [
      { id: 1, role: "user", content: "회의록" },
      { id: 2, role: "assistant", content: "서버 답변", meeting: originalMeeting },
    ],
  }).returning();
  const response = await PATCH(new Request("https://glossary.example.com/api/v1/chat", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: conversation!.id, messages: [
      { id: 1, role: "user", content: "회의록" },
      { id: 2, role: "assistant", content: "위조 답변", meeting: { summary: { text: "위조", evidenceIds: [] }, evidence: [] } },
    ] }),
  }));
  expect(response.status).toBe(200);
  const restored = await (await GET(new Request(`https://glossary.example.com/api/v1/chat?session=${conversation!.id}`))).json();
  expect(restored.conversation.messages[1]).toMatchObject({ content: "서버 답변", meeting: originalMeeting });
});
