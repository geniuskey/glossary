import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, termRelations, terms } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { generateApiKey } from "../src/lib/auth/api-key.js";

const complete = vi.hoisted(() => vi.fn());
const neighbors = vi.hoisted(() => ({ map: new Map<string, Array<{ a: string; b: string; score: number }>>() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("../src/lib/ai/provider", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/lib/ai/provider.js")>(), completeAi: complete }));
vi.mock("../src/lib/ai/config", () => ({ loadAiConfig: async () => ({ enabled: true }), runtimeAiConfig: () => ({}) }));
vi.mock("../src/lib/discovery/load", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/discovery/load.js")>(),
  loadSimilarities: async (ids: string[]) => ids.flatMap((id) => neighbors.map.get(id) ?? []),
}));
const { POST } = await import("../src/app/api/v1/discovery/relations/curate/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const termIds: string[] = [], keyIds: string[] = [];
afterEach(() => { complete.mockReset(); neighbors.map.clear(); });
afterAll(async () => {
  if (termIds.length) await db.delete(terms).where(inArray(terms.id, termIds));
  if (keyIds.length) await db.delete(apiKeys).where(inArray(apiKeys.id, keyIds));
});

async function term(name: string, definitionMd: string) {
  const { term: created } = await createTerm({ nameEn: `${name}${randomUUID().replaceAll("-", "").slice(0, 8)}`, domain: ["QA"], definitionMd, surfaces: [] }, null);
  termIds.push(created.id);
  return created;
}
async function key(scopes: string[]) {
  const { token, prefix, hash } = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ name: "관계 정리 에이전트", prefix, keyHash: hash, scopes }).returning();
  keyIds.push(row!.id);
  return { token, id: row!.id };
}
function request(body: unknown, token?: string) {
  return new Request("http://localhost/api/v1/discovery/relations/curate", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

test("read 전용 키는 거부하고, write 키는 미리보기 후 저장하며 제안자를 키로 남긴다", async () => {
  const etch = await term("Etching", "웨이퍼 표면의 물질을 화학적·물리적으로 제거해 패턴을 만드는 반도체 공정");
  const bowing = await term("EtchBowing", "깊은 식각 구조의 측벽이 가운데가 불룩하게 휘는 식각 프로파일 결함");
  neighbors.map.set(bowing.id, [{ a: bowing.id, b: etch.id, score: 0.72 }]);
  const judge = async (_config: unknown, messages: Array<{ content: string }>) => {
    expect(messages[1]!.content).toContain("측벽이 가운데가 불룩하게");
    expect(messages[1]!.content).toContain("\"id\":\"C1\"");
    return JSON.stringify({ relations: [{ candidate: "C1", type: "related_to", direction: "forward", confidence: 70, evidence: "Etch Bowing은 식각 공정에서 생기는 프로파일 결함이라 정의에 명시되어 있다" }] });
  };

  expect((await POST(request({ termSlugs: [bowing.slug] }, (await key(["read"])).token))).status).toBe(403);

  const writer = await key(["read", "write"]);
  complete.mockImplementationOnce(judge);
  const preview = await (await POST(request({ termSlugs: [bowing.slug] }, writer.token))).json() as { dryRun: boolean; items: Array<{ relations: Array<{ outcome: string; source: { id: string }; target: { id: string } }> }> };
  expect(preview.dryRun).toBe(true);
  expect(preview.items[0]!.relations).toMatchObject([{ outcome: "preview", source: { id: bowing.id }, target: { id: etch.id } }]);
  expect(await db.select().from(termRelations).where(eq(termRelations.sourceTermId, bowing.id))).toHaveLength(0);

  complete.mockImplementationOnce(judge);
  const saved = await (await POST(request({ termSlugs: [bowing.slug], dryRun: false }, writer.token))).json() as { items: Array<{ relations: Array<{ outcome: string }> }> };
  expect(saved.items[0]!.relations[0]!.outcome).toBe("proposed");
  const [row] = await db.select().from(termRelations).where(and(eq(termRelations.sourceTermId, bowing.id), eq(termRelations.targetTermId, etch.id)));
  expect(row).toMatchObject({ status: "proposed", relationType: "related_to", confidence: 70, createdBy: null, createdByKeyId: writer.id });
  expect(row!.evidenceMd).toContain("관계 정리 에이전트");

  // 이미 관계 행이 있는 쌍은 후보에서 빠져 모델을 부르지 않는다.
  const again = await (await POST(request({ termSlugs: [bowing.slug] }, writer.token))).json() as { items: Array<{ candidates: number }> };
  expect(again.items[0]!.candidates).toBe(0);
  expect(complete).toHaveBeenCalledTimes(2);
});

test("없는 slug는 400, slug 없이 부르면 개념 용어를 offset부터 limit개 처리하고 nextOffset을 준다", async () => {
  const writer = await key(["read", "write"]);
  const missing = await POST(request({ termSlugs: ["no-such-term-slug"] }, writer.token));
  expect(missing.status).toBe(400);
  expect((await missing.json() as { error: { details: { missingTermSlugs: string[] } } }).error.details.missingTermSlugs).toEqual(["no-such-term-slug"]);

  await term("PagingConcept", "다음 페이지 확인을 위해 충분한 길이의 정의를 가진 개념 용어입니다.");
  const first = await (await POST(request({ limit: 1 }, writer.token))).json() as { total: number; offset: number; nextOffset: number | null; items: unknown[] };
  expect(first.items).toHaveLength(1);
  expect(first.total).toBeGreaterThanOrEqual(1);
  expect(first.nextOffset).toBe(first.total > 1 ? 1 : null);
});
