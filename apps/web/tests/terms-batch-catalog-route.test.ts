import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, termBatchReceipts, terms } from "@glossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { POST: batch } = await import("../src/app/api/v1/terms/batch/route.js");
const { GET: catalog } = await import("../src/app/api/v1/terms/catalog/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const keyIds: string[] = [];
const termIds: string[] = [];

async function makeKey(scopes: string[]) {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db.insert(apiKeys).values({ name: "batch catalog route test", prefix, keyHash: hash, scopes }).returning();
  keyIds.push(key!.id);
  return token;
}

async function sendBatch(token: string, batchKey: string, items: unknown[], dryRun = false) {
  return batch(new Request("http://localhost/api/v1/terms/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": batchKey },
    body: JSON.stringify({ dryRun, items }),
  }));
}

afterEach(async () => {
  for (const id of termIds.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of keyIds.splice(0)) {
    await db.delete(termBatchReceipts).where(eq(termBatchReceipts.actor, `key:${id}`));
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }
});

test("일괄 반영은 성공 행을 재사용하고 같은 행 key의 다른 입력을 거부한다", async () => {
  const token = await makeKey(["write"]);
  const batchKey = randomUUID();
  const row = { key: "one", operation: "create", term: { nameEn: `Batch ${randomUUID()}` } };
  const first = await sendBatch(token, batchKey, [row]);
  expect(first.status).toBe(200);
  const saved = await first.json();
  expect(saved.results[0].outcome).toBe("created");
  termIds.push(saved.results[0].term.id);

  const replay = await sendBatch(token, batchKey, [row]);
  expect(replay.status).toBe(200);
  expect((await replay.json()).results[0]).toMatchObject({ outcome: "created", replayed: true, term: { id: saved.results[0].term.id } });

  const changed = await sendBatch(token, batchKey, [{ ...row, term: { nameEn: `Changed ${randomUUID()}` } }]);
  expect(changed.status).toBe(409);
  expect((await changed.json()).error.code).toBe("operation_conflict");
});

test("부분 실패를 고쳐 재시도하면 성공 행만 재사용하고 실패 행을 등록한다", async () => {
  const token = await makeKey(["write"]);
  const batchKey = randomUUID();
  const good = { key: "good", operation: "create", term: { nameEn: `Good ${randomUUID()}` } };
  const bad = { key: "bad", operation: "create", term: {} };
  const first = await sendBatch(token, batchKey, [bad, good]);
  expect(first.status).toBe(200);
  const initial = await first.json();
  expect(initial.results.map((result: { outcome: string }) => result.outcome)).toEqual(["invalid", "created"]);
  termIds.push(initial.results[1].term.id);

  const fixed = { ...bad, term: { nameEn: `Fixed ${randomUUID()}` } };
  const retry = await sendBatch(token, batchKey, [fixed, good]);
  expect(retry.status).toBe(200);
  const results = (await retry.json()).results;
  expect(results[0].outcome).toBe("created");
  expect(results[0].replayed).toBeUndefined();
  expect(results[1]).toMatchObject({ outcome: "created", replayed: true, term: { id: initial.results[1].term.id } });
  termIds.push(results[0].term.id);
});

test("카탈로그는 같은 ETag에 304를 반환한다", async () => {
  const token = await makeKey(["read"]);
  const url = "http://localhost/api/v1/terms/catalog";
  const first = await catalog(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
  expect(first.status).toBe(200);
  const etag = first.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect((await first.json()).catalogVersion).toBe(etag!.slice(1, -1));

  const cached = await catalog(new Request(url, { headers: { authorization: `Bearer ${token}`, "if-none-match": etag! } }));
  expect(cached.status).toBe(304);
  expect(cached.headers.get("etag")).toBe(etag);
  expect(await cached.text()).toBe("");
});

test("대표 표기가 기존 용어나 같은 요청의 앞선 행과 겹쳐도 거부하지 않고 경고와 함께 저장한다", async () => {
  const token = await makeKey(["write"]);
  const name = `Batch Dup ${randomUUID()}`;
  const first = await (await sendBatch(token, randomUUID(), [{ key: "base", operation: "create", term: { nameEn: name } }])).json();
  expect(first.results[0].outcome).toBe("created");
  termIds.push(first.results[0].term.id);

  const rows = [
    { key: "a", operation: "create", term: { nameEn: name } },
    { key: "b", operation: "create", term: { nameEn: name } },
  ];
  const checked = await (await sendBatch(token, randomUUID(), rows, true)).json();
  expect(checked.results[0]).toMatchObject({ outcome: "would_create" });
  expect(checked.results[0].warnings.length).toBeGreaterThan(0);
  expect(checked.results[1]).toMatchObject({ outcome: "would_create", conflictingRowKey: "a" });

  const saved = await (await sendBatch(token, randomUUID(), rows)).json();
  expect(saved.results.map((result: { outcome: string }) => result.outcome)).toEqual(["created", "created"]);
  for (const result of saved.results) termIds.push(result.term.id);
  expect(saved.results[0].warnings.some((warning: { conflictingSlug: string }) => warning.conflictingSlug === first.results[0].term.slug)).toBe(true);

  const other = await (await sendBatch(token, randomUUID(), [{ key: "other", operation: "create", term: { nameEn: `Batch Other ${randomUUID()}` } }])).json();
  termIds.push(other.results[0].term.id);
  const renamed = await (await sendBatch(token, randomUUID(), [
    { key: "rename", operation: "update", idOrSlug: other.results[0].term.id, expectedRevision: 1, term: { nameEn: name } },
  ])).json();
  expect(renamed.results[0]).toMatchObject({ outcome: "updated", term: { nameEn: name } });
  expect(renamed.results[0].warnings.length).toBeGreaterThan(0);
});
