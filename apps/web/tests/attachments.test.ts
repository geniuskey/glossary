import { describe, expect, test } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { attachmentRefs, attachments, createDb, terms } from "@grossary/db";
import { extractAttachmentHashes } from "../src/lib/attachments/refs.js";
import { MAX_IMAGE_EDGE, processImage, safeOriginalFilename } from "../src/lib/attachments/image.js";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);

describe("첨부 이미지 처리", () => {
  test("PNG를 메타데이터 없는 WebP로 변환하고 긴 변을 제한한다", async () => {
    const input = await sharp({ create: { width: 3000, height: 1200, channels: 4, background: "#6b5ce7" } })
      .png()
      .toBuffer();
    const result = await processImage(input);

    expect(result.storedMime).toBe("image/webp");
    expect(result.width).toBe(MAX_IMAGE_EDGE);
    expect(result.height).toBe(1024);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("파일명에서 경로와 헤더 문자를 제거한다", () => {
    expect(safeOriginalFilename('C:\\fakepath\\probe\r\n".png')).toBe("probe___.png");
  });
});

test("본문에 실제로 사용된 내부 첨부 해시만 중복 없이 찾는다", () => {
  const hash = "a".repeat(64);
  expect(extractAttachmentHashes(`![](/api/v1/attachments/${hash})\n![](/api/v1/attachments/${hash})`)).toEqual([hash]);
  expect(extractAttachmentHashes("![](https://example.com/image.webp)")).toEqual([]);
});

test("용어 저장과 수정이 현재 본문의 첨부 참조를 동기화한다", async () => {
  const data = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#ffffff" } }).webp().toBuffer();
  const image = await processImage(data);
  const [attachment] = await db.insert(attachments).values({
    sha256: image.sha256,
    data: image.data,
    storedMime: image.storedMime,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height,
    originalFilename: "ref-test.webp",
    originalMime: "image/webp",
    originalBytes: data.length,
  }).onConflictDoUpdate({ target: attachments.sha256, set: { originalFilename: "ref-test.webp" } }).returning();

  let termId: string | undefined;
  try {
    const created = await createTerm({
      termType: "concept",
      nameEn: `Attachment Ref ${Date.now()}`,
      domain: [],
      status: "draft",
      surfaces: [],
      bodyMd: `![diagram](/api/v1/attachments/${image.sha256})`,
    }, null);
    termId = created.term.id;

    expect(await db.select().from(attachmentRefs).where(eq(attachmentRefs.termId, termId))).toHaveLength(1);
    const updated = await updateTerm(termId, { bodyMd: "이미지를 제거한 본문" }, null, 1);
    expect("term" in updated).toBe(true);
    expect(await db.select().from(attachmentRefs).where(eq(attachmentRefs.termId, termId))).toHaveLength(0);
  } finally {
    if (termId) await db.delete(terms).where(eq(terms.id, termId));
    await db.delete(attachments).where(eq(attachments.id, attachment!.id));
  }
});
