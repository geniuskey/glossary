export const WIKI_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_WIKI_PAGE_SIZE = WIKI_PAGE_SIZE_OPTIONS[0];

export function parseWikiPageSize(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return WIKI_PAGE_SIZE_OPTIONS.includes(parsed as (typeof WIKI_PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_WIKI_PAGE_SIZE;
}
