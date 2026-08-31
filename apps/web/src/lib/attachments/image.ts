import { createHash } from "node:crypto";
import sharp, { type Metadata, type Sharp } from "sharp";

export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 2560;
export const IMAGE_UPLOAD_CONTENT_LENGTH_SLOP = 64 * 1024;

const ACCEPTED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

export interface ProcessedImage {
  data: Buffer;
  sha256: string;
  storedMime: "image/webp";
  byteSize: number;
  width: number;
  height: number;
}

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported" | "too_large" | "invalid",
  ) {
    super(message);
  }
}

/** EXIF 방향을 적용하고 메타데이터를 버린 뒤, 작은 WebP 인코딩을 고른다. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageProcessingError("빈 이미지입니다.", "invalid");
  if (input.length > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageProcessingError("원본 이미지는 10MB 이하여야 합니다.", "too_large");
  }

  let source: Sharp;
  let metadata: Metadata;
  try {
    source = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 });
    metadata = await source.metadata();
  } catch {
    throw new ImageProcessingError("손상되었거나 읽을 수 없는 이미지입니다.", "invalid");
  }

  if (!metadata.format || !ACCEPTED_INPUT_FORMATS.has(metadata.format)) {
    throw new ImageProcessingError("PNG, JPEG, WebP 이미지만 첨부할 수 있습니다.", "unsupported");
  }

  const normalized = source.rotate().resize({
    width: MAX_IMAGE_EDGE,
    height: MAX_IMAGE_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  const [lossless, quality82] = await Promise.all([
    normalized.clone().webp({ lossless: true, effort: 4 }).toBuffer(),
    normalized.clone().webp({ quality: 82, effort: 4, smartSubsample: true }).toBuffer(),
  ]);
  let data = lossless.length < quality82.length ? lossless : quality82;

  if (data.length > MAX_IMAGE_OUTPUT_BYTES) {
    for (const quality of [72, 62, 52, 42]) {
      const candidate = await normalized.clone().webp({ quality, effort: 4, smartSubsample: true }).toBuffer();
      if (candidate.length < data.length) data = candidate;
      if (data.length <= MAX_IMAGE_OUTPUT_BYTES) break;
    }
  }

  if (data.length > MAX_IMAGE_OUTPUT_BYTES) {
    throw new ImageProcessingError("WebP로 변환해도 2MB를 넘습니다. 이미지를 나누거나 해상도를 낮춰 주세요.", "too_large");
  }

  const stored = await sharp(data).metadata();
  if (!stored.width || !stored.height) {
    throw new ImageProcessingError("변환된 이미지의 크기를 확인할 수 없습니다.", "invalid");
  }

  return {
    data,
    sha256: createHash("sha256").update(data).digest("hex"),
    storedMime: "image/webp",
    byteSize: data.length,
    width: stored.width,
    height: stored.height,
  };
}

export function safeOriginalFilename(value: string): string {
  const leaf = value.replaceAll("\\", "/").split("/").pop()?.trim() || "clipboard-image";
  return leaf.replace(/[\r\n\0"]/g, "_").slice(0, 240) || "clipboard-image";
}
