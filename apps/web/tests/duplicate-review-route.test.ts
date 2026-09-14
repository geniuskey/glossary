import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { terms, users } from "@glossary/db";
import { getDb } from "../src/lib/db";
import { createTerm } from "../src/lib/terms/create";
import { currentRevisionNumber, updateTerm } from "../src/lib/terms/update";
import { getTermByIdOrSlug } from "../src/lib/terms/query";
import { DEFAULT_SPLIT_OPTIONS } from "../src/lib/import/review";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), complete: vi.fn() }));
vi.mock("@/lib/auth/require", () => ({ requireAuth: mocks.auth, isResponse: (v: unknown) => v instanceof Response }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ enabled: true }), runtimeAiConfig: () => ({}) }));
vi.mock("@/lib/ai/provider", () => ({ completeAi: mocks.complete }));
import { GET, POST, PATCH } from "../src/app/api/v1/contributions/duplicates/route";
import { POST as importRows } from "../src/app/api/v1/import/review/route";

const ids: string[] = [];
let userId: string;
const suffix = Date.now().toString(36);
beforeAll(async () => {
  const [user] = await getDb().insert(users).values({ email: `duplicate-${suffix}@example.com`, name: "중복 검토 테스트" }).returning();
  userId = user!.id;
});
beforeEach(() => { mocks.auth.mockReset().mockResolvedValue({ kind: "user", user: { id: userId, role: "editor" } }); mocks.complete.mockReset(); });
afterAll(async () => { if (ids.length) await getDb().delete(terms).where(inArray(terms.id, ids)); await getDb().delete(users).where(eq(users.id, userId)); });
async function seed(name: string) {
  const { term } = await createTerm({ nameEn: `${name}${suffix}`, definitionMd: "자동으로 노출을 조절합니다.", bodyMd: "기존 본문", domain: [], category: [], surfaces: [], qualityProfile: "auto" }, userId);
  ids.push(term.id); return term;
}
const request = (method: string, body: unknown) => new Request("http://localhost/api/v1/contributions/duplicates", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("candidate review returns only known candidates, and stale AI approval cannot merge changed terms", async () => {
  const target = await seed("Exposure"), source = await seed("Exposure");
  mocks.complete.mockImplementation(async () => {
    await updateTerm(target.id, { bodyMd: "검토 중 다른 사람이 수정한 본문" }, userId, 1);
    return JSON.stringify({ results: [{ id: target.id, verdict: "same", reason: "정의가 같은 자동 노출 개념" }, { id: "invented", verdict: "same", reason: "모델이 만든 ID" }] });
  });
  const response = await POST(request("POST", { termId: source.id }));
  expect(response.status).toBe(200);
  const review = await response.json();
  expect(review.candidates.map((c: { id: string }) => c.id)).not.toContain("invented");
  expect(review.candidates.find((c: { id: string }) => c.id === target.id).revision).toBe(1);
  expect((await PATCH(request("PATCH", { sourceId: source.id, targetId: target.id, sourceRevision: review.revision, targetRevision: 1 }))).status).toBe(409);
  expect(await currentRevisionNumber(source.id)).toBe(1);
});

test("import merges into the selected existing term without creating a numbered slug", async () => {
  const target = await seed("ImportTarget");
  const text = `${target.nameEn}\t추가 한국어\t추가 본문`;
  async function inspect(decisions: unknown[] = [], apply = false) {
    const form = new FormData(); form.set("text", text); form.set("apply", String(apply));
    form.set("review", JSON.stringify({ options: DEFAULT_SPLIT_OPTIONS, columns: ["bodyMd"], decisions }));
    return importRows(new Request("http://localhost/api/v1/import/review", { method: "POST", body: form }));
  }
  const initial = await (await inspect()).json();
  initial.report.rows[0].mergeIntoTerm = { id: target.id, revision: 1 };
  const preview = await (await inspect(initial.report.rows)).json();
  expect(preview.report.rows[0].mergePreview).toContain("기존 본문");
  expect(preview.report.rows[0].mergePreview).toContain("추가 본문");
  preview.report.rows[0].approval = preview.report.rows[0].fingerprint;
  const result = await (await inspect(preview.report.rows, true)).json();
  expect(result.created).toBe(0); expect(result.merged).toBe(1); expect(result.completed).toEqual([1]);
  expect(await currentRevisionNumber(target.id)).toBe(2);
  expect((await getTermByIdOrSlug(target.id))?.bodyMd).toBe("기존 본문\n\n추가 본문");
  expect(await getTermByIdOrSlug(`${target.slug}-2`)).toBeNull();
  const replay = await (await inspect(preview.report.rows, true)).json();
  expect(replay.needsReview).toBe(true); expect(await currentRevisionNumber(target.id)).toBe(2);
});

test("unauthenticated callers cannot inspect or merge", async () => {
  mocks.auth.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await GET(new Request("http://localhost/api/v1/contributions/duplicates"))).status).toBe(401);
  expect((await POST(request("POST", {}))).status).toBe(401);
  expect((await PATCH(request("PATCH", {}))).status).toBe(401);
  expect(mocks.complete).not.toHaveBeenCalled();
});
