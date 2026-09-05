export type DropEdge = "before" | "after";

export function reorderByKey<T extends { key: string }>(
  items: readonly T[],
  sourceKey: string,
  targetKey: string,
  edge: DropEdge,
): T[] {
  if (sourceKey === targetKey) return [...items];

  const source = items.find((item) => item.key === sourceKey);
  if (!source || !items.some((item) => item.key === targetKey)) return [...items];

  const reordered = items.filter((item) => item.key !== sourceKey);
  const targetIndex = reordered.findIndex((item) => item.key === targetKey);
  const insertionIndex = edge === "after" ? targetIndex + 1 : targetIndex;
  reordered.splice(insertionIndex, 0, source);
  return reordered;
}
