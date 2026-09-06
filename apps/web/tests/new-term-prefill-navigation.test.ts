import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(testDir, "..", "src", "app");

test("검색 결과의 새 용어 제안은 검색어를 생성 폼 초기값까지 전달한다", () => {
  const home = readFileSync(path.join(appDir, "page.tsx"), "utf8");
  const newPage = readFileSync(path.join(appDir, "new", "page.tsx"), "utf8");

  expect(home).toContain("href={newTermHref(q)}");
  expect(newPage).toContain("const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery");
  expect(newPage).toContain("initial={newTermFormState(searchQuery)}");
});
