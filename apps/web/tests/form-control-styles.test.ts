import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(path.join(testDir, "..", "src", "app", "globals.css"), "utf8");

test("콤보박스는 일반 입력창과 구분되는 표면과 화살표를 사용한다", () => {
  const selectStyles = styles.slice(styles.indexOf("select.field {"), styles.indexOf("select.field option"));

  expect(selectStyles).toContain("appearance-none");
  expect(selectStyles).toContain("border-line-strong");
  expect(selectStyles).toContain("bg-panel-2");
  expect(selectStyles).toContain("shadow-sm");
  expect(selectStyles).toContain("background-image:");
  expect(selectStyles).toContain("rgb(var(--brand))");
});

test("표기 배지용 정보 색상은 밝고 어두운 테마에 모두 정의된다", () => {
  expect(styles.match(/--info:/g)?.length).toBe(3);
  expect(styles.match(/--info-soft:/g)?.length).toBe(3);
});
