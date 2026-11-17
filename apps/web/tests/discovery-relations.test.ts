import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, termRelations, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { relationProposals } from "../src/lib/discovery/proposals.js";
import type { DiscoveryNode, DiscoverySignal } from "../src/lib/discovery/signals.js";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && cookie ? { name, value: cookie } : undefined }) }));
const { POST } = await import("../src/app/api/v1/discovery/relations/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const termIds: string[] = [], userIds: string[] = [], keyIds: string[] = [];
afterEach(() => { cookie = undefined; });
afterAll(async () => {
  if (termIds.length) await db.delete(terms).where(inArray(terms.id, termIds));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  for (const id of keyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

function request(body?: unknown, token?: string) {
  return new Request("http://localhost/api/v1/discovery/relations", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

async function chain(label: string) {
  const make = async (part: string) => {
    const { term } = await createTerm({ nameEn: `${label}${part}${randomUUID().replaceAll("-", "").slice(0, 10)}`, domain: ["QA"], definitionMd: `${part} 정의`, surfaces: [] }, null);
    termIds.push(term.id);
    return term.id;
  };
  const [a, b, c] = [await make("A"), await make("B"), await make("C")];
  await db.insert(termRelations).values([
    { sourceTermId: a, targetTermId: b, relationType: "part_of", status: "approved", confidence: 80, evidenceMd: "근거", sourceRevision: 1, targetRevision: 1 },
    { sourceTermId: b, targetTermId: c, relationType: "part_of", status: "approved", confidence: 90, evidenceMd: "근거", sourceRevision: 1, targetRevision: 1 },
  ]);
  return { a, b, c };
}

async function user() {
  const [row] = await db.insert(users).values({ email: `${randomUUID()}@example.test`, name: "발굴 검토자", role: "editor", passwordHash: "unused" }).returning();
  userIds.push(row!.id);
  return row!;
}

type Item = { sourceTermId: string; targetTermId: string; relationType: string; confidence: number; outcome?: string };

test("관계 제안은 로그인 사용자만 만들 수 있다", async () => {
  expect((await POST(request({}))).status).toBe(401);
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db.insert(apiKeys).values({ name: "발굴 제안 테스트", prefix, keyHash: hash, scopes: ["read", "write"] }).returning();
  keyIds.push(key!.id);
  expect((await POST(request({}, token))).status).toBe(403);
});

test("함의된 관계를 미리보기로 보여 주고, 저장하면 proposed로만 남기며 다시 제안하지 않는다", async () => {
  const { a, c } = await chain("Implied");
  cookie = (await createSession((await user()).id)).token;

  const preview = await (await POST(request({ kinds: ["implied"], limit: 50 }))).json() as { dryRun: boolean; items: Item[] };
  expect(preview.dryRun).toBe(true);
  const mine = preview.items.find((item) => item.sourceTermId === a && item.targetTermId === c);
  expect(mine).toMatchObject({ relationType: "part_of", confidence: 72 });
  expect(await db.select().from(termRelations).where(and(eq(termRelations.sourceTermId, a), eq(termRelations.targetTermId, c)))).toHaveLength(0);

  const saved = await (await POST(request({ kinds: ["implied"], limit: 50, dryRun: false }))).json() as { items: Item[] };
  expect(saved.items.find((item) => item.sourceTermId === a && item.targetTermId === c)?.outcome).toBe("proposed");
  const [row] = await db.select().from(termRelations).where(and(eq(termRelations.sourceTermId, a), eq(termRelations.targetTermId, c)));
  expect(row).toMatchObject({ status: "proposed", relationType: "part_of", confidence: 72, sourceRevision: 1, targetRevision: 1 });
  expect(row!.evidenceMd).toContain("추이 관계에서 함의됨");

  const again = await (await POST(request({ kinds: ["implied"], limit: 50 }))).json() as { items: Item[] };
  expect(again.items.some((item) => item.sourceTermId === a && item.targetTermId === c)).toBe(false);
});

test("검토자가 거절한 쌍은 다시 제안하지 않는다", async () => {
  const { a, c } = await chain("Rejected");
  await db.insert(termRelations).values({ sourceTermId: c, targetTermId: a, relationType: "related_to", status: "rejected", confidence: 50, evidenceMd: "거절", sourceRevision: 1, targetRevision: 1 });
  cookie = (await createSession((await user()).id)).token;
  const preview = await (await POST(request({ kinds: ["implied"], limit: 50 }))).json() as { items: Item[] };
  expect(preview.items.some((item) => [item.sourceTermId, item.targetTermId].includes(a) && [item.sourceTermId, item.targetTermId].includes(c))).toBe(false);
});

test("숨은 연결은 근거가 강할 때만 related_to로 제안한다", () => {
  const node = (id: string): DiscoveryNode => ({ id, slug: id, name: id, domains: [], categories: [], definitionChars: 100, status: "active" });
  const nodes = new Map(["a", "b", "c", "d"].map((id) => [id, node(id)]));
  const latent = (id: string, termIds: [string, string], metrics: Record<string, number>): DiscoverySignal => ({ id, kind: "latent_link", termIds, viaTermIds: [], domains: [], score: 1, novelty: 1, metrics, summary: "요약." });
  const proposals = relationProposals([
    latent("weak", ["a", "b"], { commonNeighbors: 2, sharedPages: 1, similarity: 0.7 }),
    latent("neighbors", ["a", "c"], { commonNeighbors: 3, sharedPages: 0, similarity: 0 }),
    latent("similar", ["b", "d"], { commonNeighbors: 0, sharedPages: 0, similarity: 0.85 }),
    latent("existing", ["c", "d"], { commonNeighbors: 5, sharedPages: 0, similarity: 0 }),
    latent("variant", ["a", "d"], { commonNeighbors: 0, sharedPages: 0, similarity: 0.99, nearDuplicate: 1 }),
  ], nodes, new Set(["c|d"]));
  expect(proposals.map((proposal) => proposal.signalId)).toEqual(["neighbors", "similar"]);
  expect(proposals.every((proposal) => proposal.relationType === "related_to" && proposal.confidence <= 85)).toBe(true);
});
