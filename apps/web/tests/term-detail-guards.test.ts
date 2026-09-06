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

test("같은 개념의 표기는 다른 페이지로 오해하지 않도록 비상호작용 목록으로 보여준다", () => {
  const surfaceList = detailSource.slice(
    detailSource.indexOf('<section className="mt-6" aria-labelledby="surfaces-heading">'),
    detailSource.indexOf("{relatedTerms.length > 0"),
  );
  expect(surfaceList).toContain("term.surfaces.map");
  expect(surfaceList).toContain("이 개념을 가리키는 표기");
  expect(surfaceList).toContain('<HelpTip text="아래 표현으로 검색해도 모두 이 개념으로 연결됩니다." />');
  expect(surfaceList).not.toContain('<p className="mt-1 text-xs');
  expect(surfaceList).not.toContain("<Link");
  expect(surfaceList).not.toContain("<IconArrow");
});

test("관련 용어의 부연 설명은 상시 문구 대신 도움말로 제공한다", () => {
  expect(detailSource).toContain('<HelpTip text="같은 도메인, 업무 분류나 주제에서 이어지는 개념입니다." />');
});

test("정의와 본문을 같은 개념의 표기보다 먼저 보여준다", () => {
  expect(detailSource.indexOf('id="definition-heading"')).toBeLessThan(detailSource.indexOf('id="surfaces-heading"'));
  expect(detailSource.indexOf('>본문</h2>')).toBeLessThan(detailSource.indexOf('id="surfaces-heading"'));
});

test("공용 검색창은 모바일 키보드를 임의로 열지 않도록 자동 포커스가 기본 해제된다", () => {
  expect(searchSource).toContain("autoFocus = false");
});
