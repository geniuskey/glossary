import { describe, expect, test } from "vitest";
import { reorderByKey } from "../src/lib/ui/reorder";
import { getRowDragPreview, rowDragOffset } from "../src/lib/ui/table-row-drag";

const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];

describe("reorderByKey", () => {
  test("항목을 대상의 앞이나 뒤로 옮긴다", () => {
    expect(reorderByKey(items, "a", "c", "before").map((item) => item.key)).toEqual(["b", "a", "c", "d"]);
    expect(reorderByKey(items, "d", "b", "after").map((item) => item.key)).toEqual(["a", "b", "d", "c"]);
  });

  test("같은 항목이나 없는 키를 받으면 순서를 유지한다", () => {
    expect(reorderByKey(items, "b", "b", "before")).toEqual(items);
    expect(reorderByKey(items, "missing", "b", "after")).toEqual(items);
    expect(reorderByKey(items, "a", "missing", "after")).toEqual(items);
  });

  test("원본 배열은 바꾸지 않는다", () => {
    reorderByKey(items, "a", "d", "after");
    expect(items.map((item) => item.key)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("row drag preview", () => {
  test("아래로 옮길 때 사이 행을 위로 밀어 빈자리를 만든다", () => {
    const preview = getRowDragPreview(items, "a", "c", "after", 32);
    expect(rowDragOffset(0, preview)).toBe(0);
    expect(rowDragOffset(1, preview)).toBe(-32);
    expect(rowDragOffset(2, preview)).toBe(-32);
    expect(rowDragOffset(3, preview)).toBe(0);
  });

  test("위로 옮길 때 사이 행을 아래로 밀어 빈자리를 만든다", () => {
    const preview = getRowDragPreview(items, "d", "b", "before", 36);
    expect(rowDragOffset(0, preview)).toBe(0);
    expect(rowDragOffset(1, preview)).toBe(36);
    expect(rowDragOffset(2, preview)).toBe(36);
    expect(rowDragOffset(3, preview)).toBe(0);
  });
});
