import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { terms, users } from "@glossary/db";
import { getDb } from "../src/lib/db";
import { createTerm } from "../src/lib/terms/create";
import { listPersonalSuggestionTasks } from "../src/lib/ai/suggestion-dispositions";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/require", () => ({ requireAuth: mocks.auth, isResponse: (value: unknown) => value instanceof Response }));

import { DELETE, POST } from "../src/app/api/v1/contributions/suggestion-dispositions/route";

const suffix = Date.now().toString(36);
let userId: string;
let termId: string;
let decisionId: string;

beforeAll(async () => {
  const [user] = await getDb().insert(users).values({ email: `suggestion-disposition-${suffix}@example.com`, name: "AI 제안 상태 테스트" }).returning();
  userId = user!.id;
  const created = await createTerm({
    nameEn: `DispositionTerm${suffix}`,
    nameKo: "제안 상태 테스트",
    definitionMd: "AI 제안 상태를 검증하기 위한 용어입니다.",
    bodyMd: "테스트 본문",
    domain: [],
    category: [],
    surfaces: [],
    qualityProfile: "auto",
  }, userId);
  termId = created.term.id;
});

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ kind: "user", user: { id: userId, role: "editor" } });
});

afterAll(async () => {
  if (termId) await getDb().delete(terms).where(eq(terms.id, termId));
  if (userId) await getDb().delete(users).where(eq(users.id, userId));
});

function request(method: string, body: unknown): Request {
  return new Request("http://localhost/api/v1/contributions/suggestion-dispositions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("개인 저장은 내 작업에만 남고 다시 열 때 결정이 제거된다", async () => {
  const response = await POST(request("POST", {
    termId,
    revision: 1,
    feature: "identity",
    suggestionId: "identity-test-fullNameEn-0",
    generatorVersion: 2,
    disposition: "saved",
    reason: "원문 확인 후 처리",
    payload: { title: "영문 확장명", value: "Objectives and Key Results" },
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  decisionId = body.decision.id;
  expect(body.decision.scope).toBe("personal");
  expect((await listPersonalSuggestionTasks(userId)).map((item) => item.id)).toContain(decisionId);

  const removed = await DELETE(request("DELETE", { decisionId }));
  expect(removed.status).toBe(204);
  expect((await listPersonalSuggestionTasks(userId)).map((item) => item.id)).not.toContain(decisionId);
});

test("개인 저장은 API key와 다른 사용자에게 노출되지 않는다", async () => {
  mocks.auth.mockResolvedValue({ kind: "key", keyId: "key-test", scopes: ["write"] });
  const response = await POST(request("POST", {
    termId,
    revision: 1,
    feature: "definition",
    suggestionId: "definition",
    generatorVersion: 1,
    disposition: "saved",
  }));
  expect(response.status).toBe(409);
});
