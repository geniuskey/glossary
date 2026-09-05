import { eq } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import sharp from "sharp";
import { apiKeys, attachments, createDb } from "@glossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const { POST: uploadImage } = await import("../src/app/api/v1/attachments/route.js");
const { GET: getImage } = await import("../src/app/api/v1/attachments/[sha256]/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const keyIds: string[] = [];
const imageHashes: string[] = [];

async function makeKey(scopes: string[]): Promise<string> {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db.insert(apiKeys).values({ name: "attachment route test", prefix, keyHash: hash, scopes }).returning();
  keyIds.push(key!.id);
  return token;
}

function arrayBufferOf(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

afterAll(async () => {
  for (const sha256 of imageHashes) await db.delete(attachments).where(eq(attachments.sha256, sha256));
  for (const id of keyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

test("이미지를 업로드해 WebP URL을 받고 같은 내용은 재사용한다", async () => {
  const token = await makeKey(["write"]);
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#735ee8" } }).png().toBuffer();

  async function send() {
    const form = new FormData();
    form.set("file", new File([arrayBufferOf(png)], "diagram.png", { type: "image/png" }));
    return uploadImage(new Request("http://x/api/v1/attachments", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }));
  }

  const first = await send();
  expect(first.status).toBe(201);
  const body = await first.json();
  imageHashes.push(body.sha256);
  expect(body).toMatchObject({ mime: "image/webp", width: 40, height: 30 });
  expect(body.url).toBe(`/api/v1/attachments/${body.sha256}`);

  const duplicate = await send();
  expect(duplicate.status).toBe(200);
  expect((await duplicate.json()).sha256).toBe(body.sha256);
});

test("첨부 조회는 WebP와 ETag를 돌려주고 조건부 요청은 304다", async () => {
  const token = await makeKey(["read"]);
  const sha256 = imageHashes[0]!;
  const url = `http://x/api/v1/attachments/${sha256}`;
  const context = { params: Promise.resolve({ sha256 }) };

  const first = await getImage(new Request(url, { headers: { authorization: `Bearer ${token}` } }), context);
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toBe("image/webp");
  expect(first.headers.get("etag")).toBe(`"${sha256}"`);
  expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);

  const cached = await getImage(new Request(url, {
    headers: { authorization: `Bearer ${token}`, "if-none-match": `"${sha256}"` },
  }), context);
  expect(cached.status).toBe(304);
});

test("이미지가 아닌 파일은 400으로 거부한다", async () => {
  const token = await makeKey(["write"]);
  const form = new FormData();
  form.set("file", new File(["not an image"], "probe.txt", { type: "text/plain" }));
  const response = await uploadImage(new Request("http://x/api/v1/attachments", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  }));
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("validation_failed");
});
