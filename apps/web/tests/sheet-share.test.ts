import { describe, expect, test } from "vitest";
import {
  DEFAULT_EMBED_COLUMN_KEYS,
  buildEmbedPath,
  buildIframeCode,
  embedBaseQuery,
  parseEmbedColumns,
  parseEmbedOptions,
} from "../src/lib/embed/sheet-share.js";

describe("시트 공유 URL", () => {
  test("현재 필터·정렬을 보존하고 열과 옵션을 URL에 명시한다", () => {
    const base = embedBaseQuery({ q: "AE", domain: "ISP", sort: "nameEn", dir: "asc", page: 3, pageSize: 50 });
    const path = buildEmbedPath(base, ["nameEn", "definitionMd"], { compact: true, links: false, border: true });
    const url = new URL(path, "https://glossary.example.com");

    expect(url.pathname).toBe("/embed");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "AE",
      domain: "ISP",
      sort: "nameEn",
      dir: "asc",
      columns: "nameEn,definitionMd",
      compact: "1",
      links: "0",
      border: "1",
    });
    expect(url.searchParams.has("page")).toBe(false);
  });

  test("정렬이 생략되어도 공유 결과는 기본 정렬을 URL에 고정한다", () => {
    expect(embedBaseQuery({ page: 1, pageSize: 50 })).toBe("sort=updatedAt&dir=desc");
  });

  test("공유용 필터는 현재 시트와 독립적으로 바꾸거나 전체로 해제한다", () => {
    const path = buildEmbedPath(
      "q=AE&status=active&domain=ISP&category=design&sort=nameEn&dir=asc",
      ["nameEn"],
      { compact: false, links: true, border: true },
      { q: "", status: "", domain: "", category: "security", topic: "인증" },
    );
    const params = new URL(path, "https://glossary.example.com").searchParams;

    expect(Object.fromEntries(params)).toMatchObject({
      category: "security",
      topic: "인증",
      sort: "nameEn",
      dir: "asc",
    });
    expect(params.has("q")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("domain")).toBe(false);
  });

  test("알 수 없는 열을 버리고 제품 열 순서를 유지한다", () => {
    expect(parseEmbedColumns("definitionMd,unknown,nameEn").map((column) => column.key)).toEqual([
      "nameEn",
      "definitionMd",
    ]);
  });

  test("유효한 열이 없으면 기본 열로 되돌린다", () => {
    expect(parseEmbedColumns("unknown").map((column) => column.key)).toEqual(DEFAULT_EMBED_COLUMN_KEYS);
  });

  test("체크박스 옵션은 1만 true로 해석하고 누락 시 안전한 기본값을 쓴다", () => {
    expect(parseEmbedOptions({ compact: "1", links: "0", border: "unexpected" })).toEqual({
      compact: true,
      links: false,
      border: false,
    });
    expect(parseEmbedOptions({})).toEqual({ compact: false, links: true, border: true });
  });

  test("iframe 코드는 접근 가능한 제목과 고정된 공유 URL을 포함한다", () => {
    expect(buildIframeCode("https://glossary.example.com/embed?columns=nameEn", false)).toBe(
      '<iframe src="https://glossary.example.com/embed?columns=nameEn" title="Glossary 용어 시트" width="100%" height="560" loading="lazy" style="border:0"></iframe>',
    );
  });
});
