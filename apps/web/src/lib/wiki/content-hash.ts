import { createHash } from "node:crypto";

export interface WikiHashInput {
  title: string;
  summary: string | null;
  sourceUrl?: string | null;
  content: string;
  domain: string[];
  termIds: string[];
}

/** wiki_pages.content_hash 값. 동기화 가져오기도 같은 값을 써야 해서 server-only인 store 밖에 둔다. */
export function wikiContentHash(input: WikiHashInput): string {
  return createHash("sha256").update(JSON.stringify({
    title: input.title,
    summary: input.summary,
    sourceUrl: input.sourceUrl,
    content: input.content,
    domain: input.domain,
    termIds: input.termIds,
  }), "utf8").digest("hex");
}
