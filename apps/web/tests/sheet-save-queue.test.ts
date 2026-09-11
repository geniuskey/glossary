import { expect, test } from "vitest";
import { createSaveQueue, savedGridRow } from "../src/lib/terms/save-queue";
import type { TermRow } from "../src/lib/terms/grid";
import type { TermWire } from "../src/lib/terms/wire";

function row(): TermRow {
  return {
    id: "term-1", slug: "term", nameEn: "Term", nameKo: null,
    fullNameEn: null, fullNameKo: null, domain: [], category: null,
    categoryLabel: null, topic: null, ownerId: null, ownerName: null,
    status: "draft", definitionMd: null, bodyMd: null,
    updatedAt: "2026-09-01T00:00:00.000Z", editorName: null, revision: 3,
  };
}

test("빠른 연속 편집은 앞선 응답의 리비전으로 저장하고 두 변경을 보존한다", async () => {
  const enqueue = createSaveQueue();
  let current = row();
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  const revisions: number[] = [];
  const first = enqueue(async () => {
    revisions.push(current.revision);
    await response;
    current = savedGridRow(current, { ...current, qualityProfile: "auto", categories: [], nameKo: "용어" }, "편집자");
  });
  const second = enqueue(async () => {
    revisions.push(current.revision);
    current = savedGridRow(current, { ...current, qualityProfile: "auto", categories: [], definitionMd: "정의", status: "active" }, "편집자");
  });
  await Promise.resolve();
  expect(revisions).toEqual([3]);
  release();
  await Promise.all([first, second]);
  expect(revisions).toEqual([3, 4]);
  expect(current).toMatchObject({ revision: 5, nameKo: "용어", definitionMd: "정의", status: "active" });
});

test("실패한 저장이 다음 저장을 막지 않는다", async () => {
  const enqueue = createSaveQueue();
  const failed = enqueue(async () => { throw new Error("network"); });
  const next = enqueue(async () => "saved");
  await expect(failed).rejects.toThrow("network");
  await expect(next).resolves.toBe("saved");
});

test("서버가 판정한 상태와 정규화된 값, 수정 시각을 사용한다", () => {
  const before = row();
  const term = {
    ...before, qualityProfile: "auto", categories: [], nameEn: "Normalized",
    status: "active", updatedAt: "2026-09-10T01:02:03.000Z",
  } satisfies TermWire;
  expect(savedGridRow(before, term, "작성자")).toMatchObject({
    nameEn: "Normalized", status: "active", updatedAt: term.updatedAt,
    revision: 4, editorName: "작성자", ownerName: null,
  });
  expect(before.revision).toBe(3);
});
