import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const detailSource = readFileSync(path.join(testDir, "..", "src", "app", "w", "[slug]", "page.tsx"), "utf8");
const searchSource = readFileSync(path.join(testDir, "..", "src", "components", "search-box.tsx"), "utf8");

test("용어 상세는 관련 용어와 현재 맥락의 관계도 진입점을 제공한다", () => {
  expect(detailSource).toContain("listRelatedTerms(term, 6)");
  expect(detailSource).toContain("같이 보면 좋은 용어");
  expect(detailSource).toContain("관계도에서 보기");
  expect(detailSource).toContain("related.sharedDomains.map");
});

test("관련 용어 링크는 키보드 포커스를 명확히 표시한다", () => {
  expect(detailSource).toContain("focus-visible:ring-2 focus-visible:ring-brand/40");
});

test("공용 검색창은 모바일 키보드를 임의로 열지 않도록 자동 포커스가 기본 해제된다", () => {
  expect(searchSource).toContain("autoFocus = false");
});
