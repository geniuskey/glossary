import {
  DEFAULT_DIR,
  DEFAULT_SORT,
  GRID_COLUMNS,
  type ColumnKey,
  type GridColumn,
} from "@/lib/terms/grid";
import type { ParsedListParams, RawSearchParams } from "@/lib/terms/list-params";

/** 공유 패널을 처음 열었을 때 문서에서 가장 자주 훑는 열만 먼저 보여준다. */
export const DEFAULT_EMBED_COLUMN_KEYS = [
  "nameEn",
  "nameKo",
  "termType",
  "domain",
  "category",
  "definitionMd",
] as const satisfies readonly ColumnKey[];

export interface EmbedTableOptions {
  compact: boolean;
  links: boolean;
  border: boolean;
}

export interface EmbedShareFilters {
  q: string;
  type: string;
  status: string;
  domain: string;
  category: string;
  topic: string;
}

export const DEFAULT_EMBED_OPTIONS: EmbedTableOptions = {
  compact: false,
  links: true,
  border: true,
};

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function flag(raw: string | string[] | undefined, fallback: boolean): boolean {
  const value = first(raw);
  if (value === undefined) return fallback;
  return value === "1";
}

/** 알 수 없는 열은 버리고, URL의 열 순서가 아니라 제품의 표준 열 순서를 따른다. */
export function parseEmbedColumns(raw: string | string[] | undefined): GridColumn[] {
  const requested = new Set((first(raw) ?? "").split(",").filter(Boolean));
  const selected = GRID_COLUMNS.filter((column) => requested.has(column.key));
  if (selected.length > 0) return selected;
  const defaults = new Set<ColumnKey>(DEFAULT_EMBED_COLUMN_KEYS);
  return GRID_COLUMNS.filter((column) => defaults.has(column.key));
}

export function parseEmbedOptions(raw: RawSearchParams): EmbedTableOptions {
  return {
    compact: flag(raw.compact, DEFAULT_EMBED_OPTIONS.compact),
    links: flag(raw.links, DEFAULT_EMBED_OPTIONS.links),
    border: flag(raw.border, DEFAULT_EMBED_OPTIONS.border),
  };
}

/** `/sheet`의 검증된 필터와 정렬만 `/embed`로 옮긴다. */
export function embedBaseQuery(params: ParsedListParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.type) query.set("type", params.type);
  if (params.domain) query.set("domain", params.domain);
  if (params.category) query.set("category", params.category);
  if (params.topic) query.set("topic", params.topic);
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (!params.sort) query.set("sort", DEFAULT_SORT);
  if (!params.dir) query.set("dir", DEFAULT_DIR);
  return query.toString();
}

export function buildEmbedPath(
  baseQuery: string,
  columns: readonly ColumnKey[],
  options: EmbedTableOptions,
  filters?: EmbedShareFilters,
): string {
  const query = new URLSearchParams(baseQuery);
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) query.set(key, value.trim());
      else query.delete(key);
    }
  }
  query.set("columns", columns.join(","));
  query.set("compact", options.compact ? "1" : "0");
  query.set("links", options.links ? "1" : "0");
  query.set("border", options.border ? "1" : "0");
  return `/embed?${query.toString()}`;
}

export function buildIframeCode(url: string, border: boolean): string {
  const style = border ? "border:1px solid #e7e3dc;border-radius:8px" : "border:0";
  return `<iframe src="${url}" title="Glossary 용어 시트" width="100%" height="560" loading="lazy" style="${style}"></iframe>`;
}
