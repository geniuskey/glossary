import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, aiReviewSuggestions, createDb, termRelations, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";
import { approvedRelations, changeRelation, createRelation, listRelations, relationForDecision, semanticGraphRelations } from "../src/lib/terms/relations.js";
import { retrieveGlossaryContext } from "../src/lib/ai/retrieval.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { decidePreparedRelationSuggestion } from "../src/lib/ai/auto-review.js";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && cookie ? { name, value: cookie } : undefined }) }));
const { GET, POST } = await import("../src/app/api/v1/relations/route.js");
const { PATCH } = await import("../src/app/api/v1/relations/[id]/route.js");
const { GET: searchTerms } = await import("../src/app/api/v1/relations/terms/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const termIds: string[] = [], userIds: string[] = [], keyIds: string[] = [];
afterEach(() => { cookie = undefined; });
afterAll(async () => {
  for (const id of termIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  for (const id of keyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

async function fixture() {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.test`, name: "관계 검토자", role: "editor", passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  const source = await createTerm({ nameEn: `Source${randomUUID().replaceAll("-", "")}`, domain: ["QA"], definitionMd: "출발 용어의 정의", surfaces: [] }, null);
  const target = await createTerm({ nameEn: `Target${randomUUID().replaceAll("-", "")}`, domain: ["QA"], definitionMd: "도착 용어의 정의", surfaces: [] }, null);
  termIds.push(source.term.id, target.term.id);
  const input = { sourceTermId: source.term.id, targetTermId: target.term.id, relationType: "used_in" as const, evidenceMd: "사내 검토 문서 3절에 사용 관계가 명시되어 있다.", sourceRevision: 1, targetRevision: 1 };
  return { source: source.term, target: target.term, user: user!, input };
}
async function proposal() {
  const f = await fixture();
  const result = await createRelation(f.input, f.user.id);
  if (!("ok" in result)) throw new Error(JSON.stringify(result));
  return { ...f, id: result.id };
}
async function version(id: string) { return (await relationForDecision(id))!.version; }
function request(method: string, body?: unknown, token?: string) {
  return new Request("http://localhost/api/v1/relations", { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("인증 없는 관계 읽기·쓰기 요청은 차단된다", async () => {
  expect((await GET(request("GET"))).status).toBe(401);
  expect((await POST(request("POST", {}))).status).toBe(401);
  expect((await PATCH(request("PATCH", {}), { params: Promise.resolve({ id: randomUUID() }) })).status).toBe(401);
});

test("API 키는 조회만 가능하며 관계 등록·승인은 로그인한 사용자만 수행한다", async () => {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db.insert(apiKeys).values({ name: "관계 조회 테스트", prefix, keyHash: hash, scopes: ["read", "write"] }).returning();
  keyIds.push(key!.id);
  expect((await GET(request("GET", undefined, token))).status).toBe(200);
  expect((await POST(request("POST", {}, token))).status).toBe(403);
  expect((await PATCH(request("PATCH", {}, token), { params: Promise.resolve({ id: randomUUID() }) })).status).toBe(403);
});

test("직접 등록 → 승인 → 그래프와 챗봇 반영 → 철회가 같은 관계를 사용한다", async () => {
  const f = await fixture();
  cookie = (await createSession(f.user.id)).token;
  const response = await POST(request("POST", f.input));
  expect(response.status).toBe(201);
  const { id } = await response.json();
  expect((await listRelations({ termId: f.source.id })).items[0]).toMatchObject({ id, status: "proposed", stale: false });
  expect((await semanticGraphRelations([f.source.id, f.target.id])).items).toHaveLength(0);
  const decision = await PATCH(request("PATCH", { action: "approved", version: await version(id) }), { params: Promise.resolve({ id }) });
  expect(decision.status).toBe(200);
  expect((await semanticGraphRelations([f.source.id, f.target.id])).items).toEqual([expect.objectContaining({ id })]);
  const context = JSON.parse((await retrieveGlossaryContext(f.source.nameEn!)).context);
  expect(context.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ type: "used_in", evidence: f.input.evidenceMd })]));
  await changeRelation(id, { action: "rejected", version: await version(id) }, f.user.id);
  expect(await approvedRelations(db, [f.source.id])).toHaveLength(0);
  expect((await semanticGraphRelations([f.source.id, f.target.id])).items).toHaveLength(0);
  expect(JSON.parse((await retrieveGlossaryContext(f.source.nameEn!)).context).relationships).toHaveLength(0);
});

test("자기 자신, 중복, 유효하지 않은 종류와 빈 근거를 거부한다", async () => {
  const f = await proposal();
  cookie = (await createSession(f.user.id)).token;
  for (const extra of [{ targetTermId: f.source.id }, { relationType: "unknown" }, { evidenceMd: "  " }, { sourceRevision: 0 }]) {
    expect((await POST(request("POST", { ...f.input, ...extra }))).status).toBe(400);
  }
  expect((await POST(request("POST", f.input))).status).toBe(409);
  expect((await GET(new Request("http://localhost/api/v1/relations?status=invalid"))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/v1/relations?page=-1"))).status).toBe(400);
});

test("용어 변경 후 관계는 그래프·검색 확장에서 제외되고 최신 정의를 확인해야 재승인할 수 있다", async () => {
  const f = await proposal();
  await changeRelation(f.id, { action: "approved", version: await version(f.id) }, f.user.id);
  await updateTerm(f.target.id, { definitionMd: "변경한 최신 정의" }, null, 1);
  expect((await listRelations({ termId: f.source.id })).items[0]).toMatchObject({ stale: true, target: { revision: 2 } });
  expect(await approvedRelations(db, [f.source.id])).toHaveLength(0);
  expect((await semanticGraphRelations([f.source.id, f.target.id])).items).toHaveLength(0);
  expect(await changeRelation(f.id, { action: "edit", version: await version(f.id), relationType: "used_in", evidenceMd: "최신 근거", sourceRevision: 1, targetRevision: 1 }, f.user.id)).toEqual({ error: "stale" });
  expect(await changeRelation(f.id, { action: "edit", version: await version(f.id), relationType: "part_of", evidenceMd: "최신 정의에 맞춘 근거", sourceRevision: 1, targetRevision: 2 }, f.user.id)).toMatchObject({ ok: true });
  expect((await listRelations({ termId: f.source.id })).items[0]).toMatchObject({ status: "proposed", stale: false });
  expect(await changeRelation(f.id, { action: "approved", version: await version(f.id) }, f.user.id)).toMatchObject({ ok: true });
  expect((await semanticGraphRelations([f.source.id, f.target.id])).items[0]?.relationType).toBe("part_of");
});

test("오래된 제안은 승인할 수 없지만 거절할 수 있다", async () => {
  const f = await proposal();
  await updateTerm(f.source.id, { definitionMd: "수정한 정의" }, null, 1);
  expect(await changeRelation(f.id, { action: "approved", version: await version(f.id) }, f.user.id)).toEqual({ error: "stale" });
  expect(await changeRelation(f.id, { action: "rejected", version: await version(f.id) }, f.user.id)).toMatchObject({ ok: true });
});

test("동시 승인·거절은 하나만 성공하며 오래된 화면으로 덮어쓸 수 없다", async () => {
  const f = await proposal();
  const snapshot = await version(f.id);
  const results = await Promise.all([
    changeRelation(f.id, { action: "approved", version: snapshot }, f.user.id),
    changeRelation(f.id, { action: "rejected", version: snapshot }, f.user.id),
  ]);
  expect(results.filter((result) => "ok" in result)).toHaveLength(1);
  expect(results.filter((result) => "error" in result)).toEqual([{ error: "conflict" }]);
});

test("그래프 표시 밖의 연결 수와 관리 목록의 상태·종류 필터를 제공한다", async () => {
  const f = await proposal();
  await changeRelation(f.id, { action: "approved", version: await version(f.id) }, f.user.id);
  expect(await semanticGraphRelations([f.source.id])).toEqual({ items: [], omitted: 1 });
  expect((await listRelations({ termId: f.target.id, status: "approved", type: "used_in" })).total).toBe(1);
  expect((await listRelations({ termId: f.target.id, status: "proposed" })).total).toBe(0);
  expect((await listRelations({ termId: f.target.id, type: "is_a" })).total).toBe(0);
});

test("사람이 수정한 관계는 이전 AI 제안에서 승인되지 않는다", async () => {
  const f = await proposal();
  const suggestionId = `relation-${f.id}`;
  await db.insert(aiReviewSuggestions).values({ termId: f.source.id, revision: 1, generatorVersion: 2, suggestions: [
    { id: suggestionId, field: "relation", value: { relationId: f.id, targetTermId: f.target.id, targetSlug: f.target.slug, targetName: f.target.nameEn, relationType: "used_in", confidence: 100 }, reason: f.input.evidenceMd, source: "agent" },
    { id: "keep", field: "definitionMd", value: "보존할 정의 제안", reason: "다른 근거", source: "rule" },
  ] });
  await changeRelation(f.id, { action: "edit", version: await version(f.id), relationType: "part_of", evidenceMd: "사람이 검토한 새 근거", sourceRevision: 1, targetRevision: 1 }, f.user.id);
  expect(await decidePreparedRelationSuggestion({ termId: f.source.id, revision: 1, suggestionId, decision: "approved", reviewedBy: f.user.id })).toBe(false);
  const [cache] = await db.select().from(aiReviewSuggestions).where(eq(aiReviewSuggestions.termId, f.source.id));
  expect(cache?.suggestions).toEqual([expect.objectContaining({ id: "keep" })]);
});

test("용어 검색은 정의와 리비전을 반환하고 변경된 검색 결과로 등록하면 충돌을 알린다", async () => {
  const f = await fixture();
  cookie = (await createSession(f.user.id)).token;
  const response = await searchTerms(new Request(`http://localhost/api/v1/relations/terms?q=${f.source.nameEn}`));
  expect(response.status).toBe(200);
  expect((await response.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.source.id, revision: 1, definition: f.source.definitionMd })]));
  await updateTerm(f.source.id, { definitionMd: "이제 바뀐 정의" }, null, 1);
  expect((await POST(request("POST", f.input))).status).toBe(409);
  expect(await createRelation({ ...f.input, sourceTermId: randomUUID() }, f.user.id)).toEqual({ error: "not_found" });
});
