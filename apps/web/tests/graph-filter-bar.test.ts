import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { graphFilterHref } from "../src/components/graph-filter-bar.js";

test("관계도 필터 URL은 선택된 값만 유지하고 모두 비우면 기본 화면이 된다", () => {
  expect(graphFilterHref("/graph", { domain: "IT", category: "", topic: "API" }))
    .toBe("/graph?domain=IT&topic=API");
  expect(graphFilterHref("/graph", { domain: "", category: "", topic: "" })).toBe("/graph");
});

test("관계도 필터는 select 변경 즉시 이동하고 적용 대신 초기화를 제공한다", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(testDir, "../src/components/graph-filter-bar.tsx"), "utf8");
  expect(source).toContain("onChange={(event) => onChange(name, event.target.value)}");
  expect(source).toContain("초기화");
  expect(source).not.toContain(">적용<");
});
