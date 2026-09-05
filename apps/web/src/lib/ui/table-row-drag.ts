import { reorderByKey, type DropEdge } from "./reorder";

export type RowDragPreview = {
  sourceIndex: number;
  destinationIndex: number;
  rowHeight: number;
};

export function getRowDragPreview<T extends { key: string }>(
  items: readonly T[],
  sourceKey: string | null,
  targetKey: string | null,
  edge: DropEdge | null,
  rowHeight: number,
): RowDragPreview | null {
  if (!sourceKey || !targetKey || !edge || rowHeight <= 0) return null;
  const sourceIndex = items.findIndex((item) => item.key === sourceKey);
  const reordered = reorderByKey(items, sourceKey, targetKey, edge);
  const destinationIndex = reordered.findIndex((item) => item.key === sourceKey);
  if (sourceIndex < 0 || destinationIndex < 0 || sourceIndex === destinationIndex) return null;
  return { sourceIndex, destinationIndex, rowHeight };
}

export function rowDragOffset(index: number, preview: RowDragPreview | null): number {
  if (!preview) return 0;
  const { sourceIndex, destinationIndex, rowHeight } = preview;
  if (sourceIndex < destinationIndex && index > sourceIndex && index <= destinationIndex) return -rowHeight;
  if (sourceIndex > destinationIndex && index >= destinationIndex && index < sourceIndex) return rowHeight;
  return 0;
}

export function setTableRowDragImage(dataTransfer: DataTransfer, row: HTMLTableRowElement): number {
  const bounds = row.getBoundingClientRect();
  const ghost = document.createElement("table");
  const body = document.createElement("tbody");
  const clone = row.cloneNode(true) as HTMLTableRowElement;
  const sourceInputs = row.querySelectorAll("input");
  const cloneInputs = clone.querySelectorAll("input");

  sourceInputs.forEach((input, index) => {
    const clonedInput = cloneInputs.item(index);
    if (clonedInput) clonedInput.value = input.value;
  });
  Array.from(row.cells).forEach((cell, index) => {
    const width = cell.getBoundingClientRect().width;
    const clonedCell = clone.cells.item(index);
    if (clonedCell) {
      clonedCell.style.width = `${width}px`;
      clonedCell.style.minWidth = `${width}px`;
      clonedCell.style.maxWidth = `${width}px`;
    }
  });

  clone.querySelectorAll<HTMLElement>("button, input").forEach((control) => {
    control.tabIndex = -1;
    control.style.pointerEvents = "none";
  });
  clone.style.opacity = "1";
  body.appendChild(clone);
  ghost.appendChild(body);
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "-9999px",
    top: "-9999px",
    width: `${bounds.width}px`,
    borderCollapse: "collapse",
    border: "1px solid rgb(var(--brand) / 0.55)",
    borderRadius: "10px",
    overflow: "hidden",
    background: "rgb(var(--panel))",
    color: "rgb(var(--ink))",
    boxShadow: "0 18px 42px rgb(0 0 0 / 0.22), 0 4px 12px rgb(var(--brand) / 0.18)",
    opacity: "0.96",
    transform: "rotate(0.35deg) scale(1.01)",
    transformOrigin: "24px center",
    pointerEvents: "none",
  });
  document.body.appendChild(ghost);
  dataTransfer.setDragImage(ghost, Math.min(28, bounds.width / 2), bounds.height / 2);
  requestAnimationFrame(() => ghost.remove());
  return bounds.height;
}
