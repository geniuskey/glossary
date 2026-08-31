const ATTACHMENT_URL_RE = /\/api\/v1\/attachments\/([a-f0-9]{64})(?![a-f0-9])/gi;

/** 본문에 실제로 들어간 내부 첨부 URL만 찾아 중복을 제거한다. */
export function extractAttachmentHashes(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  return [...new Set([...markdown.matchAll(ATTACHMENT_URL_RE)].map((match) => match[1]!.toLowerCase()))];
}
