import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, "..", "src", "components", "import-guide.tsx"), "utf8");

test("엑셀 안내는 추가 표기의 입력 위치와 다중 값 구분법을 바로 설명한다", () => {
  expect(source).toContain("추가 표기는 종류별 열에 적습니다");
  expect(source).toContain("별도의 “추가 표기” 열은 없습니다");
  expect(source).toContain("쉼표나 셀 안 줄바꿈");
  expect(source).toContain("ADDITIONAL_SURFACE_FIELDS.map");
});

test("코드값과 열 이름은 자동 번역에서 제외한다", () => {
  expect(source.match(/translate="no"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
});
