import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { createDb, syncExports, syncSources, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { decodeSyncBundle, encodeSyncBundle } from "../src/lib/sync/bundle.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: exportBundle } = await import("../src/app/api/v1/admin/sync/export/route.js");
const { POST: importBundle } = await import("../src/app/api/v1/admin/sync/import/route.js");
const { GET: syncStatus, DELETE: forgetSource } = await import("../src/app/api/v1/admin/sync/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
const createdExportIds: string[] = [];
const foreignInstanceId = randomUUID();
const ORIGIN = "http://localhost:3000";

afterAll(async () => {
  currentCookieValue = undefined;
  if (createdExportIds.length) await db.delete(syncExports).where(inArray(syncExports.id, createdExportIds));
  await db.delete(syncSources).where(eq(syncSources.instanceId, foreignInstanceId));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `sync-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `동기화 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function post(query: string, body: BodyInit) {
  return importBundle(new Request(`${ORIGIN}/api/v1/admin/sync/import?${query}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/gzip" },
    body,
  }));
}

test("동기화 API는 비로그인 사용자와 편집자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await exportBundle(new Request(`${ORIGIN}/api/v1/admin/sync/export`))).status).toBe(401);
  await loginAs("editor");
  expect((await exportBundle(new Request(`${ORIGIN}/api/v1/admin/sync/export`))).status).toBe(403);
  expect((await post("", "x")).status).toBe(403);
  expect((await syncStatus(new Request(`${ORIGIN}/api/v1/admin/sync`))).status).toBe(403);
});

test("관리자가 내려받은 번들은 기록되고, 같은 서버로 되돌려 넣으면 409로 거부된다", async () => {
  await loginAs("admin");
  const response = await exportBundle(new Request(`${ORIGIN}/api/v1/admin/sync/export?mode=full&label=route-test`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/gzip");
  expect(response.headers.get("content-disposition")).toMatch(/filename="route-test-.+-full\.glossary-sync\.json\.gz"/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const bundle = decodeSyncBundle(bytes);
  createdExportIds.push(bundle.bundleId);
  expect(JSON.stringify(bundle)).not.toContain("passwordHash");

  const status = await (await syncStatus(new Request(`${ORIGIN}/api/v1/admin/sync`))).json();
  expect(status.exports.map((item: { id: string }) => item.id)).toContain(bundle.bundleId);

  const own = await post("dryRun=true", bytes);
  expect(own.status).toBe(409);
  expect((await own.json()).error.code).toBe("operation_conflict");
});

test("가져오기는 기본이 미리보기이고, 잘못된 파일과 옵션은 400으로 알린다", async () => {
  await loginAs("admin");
  expect((await post("", "not a bundle")).status).toBe(400);
  expect((await post("localEdits=maybe", "x")).status).toBe(400);
  expect((await exportBundle(new Request(`${ORIGIN}/api/v1/admin/sync/export?mode=weird`))).status).toBe(400);

  const foreign = {
    format: "geniuskey.glossary.sync" as const,
    version: 1 as const,
    bundleId: randomUUID(),
    mode: "full" as const,
    baseBundleId: null,
    source: { instanceId: foreignInstanceId, label: "route-source", appVersion: null },
    exportedAt: new Date().toISOString(),
    manifest: { terms: {}, wikiPages: {}, relations: {}, domains: {}, businessCategories: {}, attachments: [] },
    data: { domains: [], businessCategories: [], terms: [], wikiPages: [], relations: [], attachments: [] },
  };
  const preview = await post("", new Uint8Array(encodeSyncBundle(foreign)));
  expect(preview.status).toBe(200);
  expect((await preview.json()).report.dryRun).toBe(true);
  expect(await db.select().from(syncSources).where(eq(syncSources.instanceId, foreignInstanceId))).toHaveLength(0);

  const applied = await post("dryRun=false", new Uint8Array(encodeSyncBundle(foreign)));
  expect((await applied.json()).report.dryRun).toBe(false);
  expect(await db.select().from(syncSources).where(eq(syncSources.instanceId, foreignInstanceId))).toHaveLength(1);

  const forgotten = await forgetSource(new Request(`${ORIGIN}/api/v1/admin/sync?source=${foreignInstanceId}`, { method: "DELETE", headers: { origin: ORIGIN } }));
  expect(forgotten.status).toBe(204);
});
