export const INTERNAL_ATTACHMENT_RE = /^\/api\/v1\/attachments\/[a-f0-9]{64}(?:\?width=([1-9]\d*)&height=([1-9]\d*))?$/;

export interface MarkdownImageReference {
  url: string;
  alt: string;
}

export function isInternalAttachmentUrl(source: string): boolean {
  return INTERNAL_ATTACHMENT_RE.test(source);
}

export function isExternalImageUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function markdownImageDimensions(title: string | null | undefined): { width?: number; height?: number } | null {
  if (!title) return null;
  const dimensions: { width?: number; height?: number } = {};
  for (const attribute of title.trim().split(/\s+/)) {
    const match = /^(width|height)=([1-9]\d*)$/i.exec(attribute);
    if (!match?.[1] || !match[2]) return null;
    const key = match[1].toLowerCase() as "width" | "height";
    const value = Number(match[2]);
    if (dimensions[key] !== undefined || !Number.isSafeInteger(value) || value > 10_000) return null;
    dimensions[key] = value;
  }
  return Object.keys(dimensions).length ? dimensions : null;
}

export function internalAttachmentDimensions(source: string): { width: number; height: number } | null {
  const match = INTERNAL_ATTACHMENT_RE.exec(source);
  if (!match?.[1] || !match[2]) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 10_000 || height > 10_000) return null;
  return { width, height };
}

/** Markdown 본문에서 안전하게 표시할 수 있는 내부 첨부 이미지만 추출한다. */
export function extractMarkdownImages(markdown: string | null | undefined): MarkdownImageReference[] {
  if (!markdown) return [];
  const images: MarkdownImageReference[] = [];
  const seen = new Set<string>();
  const pattern = /!\[((?:\\.|[^\]\\\n])*)\]\(([^)\n]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const url = match[2]?.trim() ?? "";
    if (!isInternalAttachmentUrl(url) || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      alt: (match[1] ?? "").replaceAll(/\\([\\\]])/g, "$1") || "첨부 이미지",
    });
  }
  return images;
}
