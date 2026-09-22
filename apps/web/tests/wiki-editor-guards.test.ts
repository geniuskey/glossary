import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, "..", "src", "components", "wiki-editor.tsx"), "utf8");

test("위키 본문도 공용 Markdown 편집기를 사용한다", () => {
  expect(source).toContain("<MarkdownEditor");
  expect(source).toContain('name="content"');
  expect(source).toContain("maxLength={200_000}");
  expect(source).toContain("onUploadingChange={setImageUploading}");
  expect(source).toContain('defaultView="glossary"');
  expect(source).not.toContain('min-h-[28rem] resize-y font-mono');
});

test("위키 편집은 미저장 변경 이탈과 빈 저장을 막는다", () => {
  expect(source).toContain("useUnsavedChanges(dirty)");
  expect(source).toContain("if (dirty && !window.confirm");
  expect(source).toContain("(editing && !dirty)");
});
