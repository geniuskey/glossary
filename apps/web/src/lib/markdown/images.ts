export const INTERNAL_ATTACHMENT_RE = /^\/api\/v1\/attachments\/[a-f0-9]{64}$/;

export function isInternalAttachmentUrl(source: string): boolean {
  return INTERNAL_ATTACHMENT_RE.test(source);
}
