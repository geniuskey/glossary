export const INTERNAL_ATTACHMENT_RE = /^\/api\/v1\/attachments\/[a-f0-9]{64}(?:\?width=([1-9]\d*)&height=([1-9]\d*))?$/;

export function isInternalAttachmentUrl(source: string): boolean {
  return INTERNAL_ATTACHMENT_RE.test(source);
}

export function internalAttachmentDimensions(source: string): { width: number; height: number } | null {
  const match = INTERNAL_ATTACHMENT_RE.exec(source);
  if (!match?.[1] || !match[2]) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 10_000 || height > 10_000) return null;
  return { width, height };
}
