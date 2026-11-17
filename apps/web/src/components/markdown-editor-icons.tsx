import type { ReactNode } from "react";

export type EditorIconName =
  | "bold" | "italic" | "strike" | "inline-code" | "link" | "inline-math"
  | "quote" | "bullet" | "ordered" | "task" | "code-block"
  | "table" | "block-math" | "mermaid" | "rule" | "image"
  | "plus" | "more" | "chevron" | "check"
  | "view-glossary" | "view-text" | "view-preview"
  | "expand" | "collapse" | "upload";

const PATHS: Record<EditorIconName, ReactNode> = {
  bold: <path d="M4.5 2.75h4.25a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 7.95h4.9a2.65 2.65 0 0 1 0 5.3H4.5z" strokeWidth="1.7" />,
  italic: <path d="M9.75 2.75 6.25 13.25M6.5 2.75h5M4.5 13.25h5" />,
  strike: <path d="M2.75 8h10.5M10.9 4.6c-.5-1.15-1.7-1.85-3.15-1.85-1.75 0-2.95.95-2.95 2.3 0 .95.55 1.55 1.6 2M5 11.2c.45 1.25 1.7 2.05 3.25 2.05 1.85 0 3.1-1 3.1-2.45 0-.55-.15-1-.45-1.35" />,
  "inline-code": <path d="M5.5 4.25 1.75 8l3.75 3.75M10.5 4.25 14.25 8l-3.75 3.75" />,
  link: <path d="M6.75 9.25a3 3 0 0 0 4.25 0l2.1-2.1a3 3 0 0 0-4.25-4.25l-.8.8M9.25 6.75a3 3 0 0 0-4.25 0l-2.1 2.1a3 3 0 0 0 4.25 4.25l.8-.8" />,
  "inline-math": <path d="M2.5 4.5h2.25L7.5 12l2-8.75h4M9.5 8.25l3.5 4M13 8.25l-3.5 4" />,
  quote: <path d="M3 4.5h3.5v3.25c0 2-1 3.25-3 3.75M9.5 4.5H13v3.25c0 2-1 3.25-3 3.75M3 4.5v3.25h3.5M9.5 4.5v3.25H13" />,
  bullet: <><circle cx="3" cy="4.25" r=".9" fill="currentColor" stroke="none" /><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="3" cy="11.75" r=".9" fill="currentColor" stroke="none" /><path d="M6 4.25h7.5M6 8h7.5M6 11.75h7.5" /></>,
  ordered: <><path d="M6.25 4.25h7.25M6.25 8h7.25M6.25 11.75h7.25" /><path d="M2.4 3.2 3.3 2.75v3M2.25 7.15c.2-.35.6-.55 1-.55.55 0 .95.35.95.85 0 .7-1.95 1.55-1.95 2.3h2" strokeWidth="1.1" /></>,
  task: <><rect x="1.75" y="2.75" width="4" height="4" rx="1" /><path d="m2.6 11.35 1 1 1.7-1.95" /><path d="M8 4.75h5.5M8 11.5h5.5" /></>,
  "code-block": <><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" /><path d="M6.25 6 4.25 8l2 2M9.75 6l2 2-2 2" /></>,
  table: <><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.75" /><path d="M1.75 6.25h12.5M1.75 10h12.5M6 6.25v7.5" /></>,
  "block-math": <path d="M12.5 3H3.5l4.75 5-4.75 5h9" />,
  mermaid: <><rect x="1.75" y="2" width="4.5" height="3.5" rx="1" /><rect x="9.75" y="10.5" width="4.5" height="3.5" rx="1" /><path d="M4 5.5v2.75a1.5 1.5 0 0 0 1.5 1.5h4.25M8.25 8.25l1.5 1.5-1.5 1.5" /></>,
  rule: <path d="M1.75 8h12.5M4 4.5h8M4 11.5h8" strokeDasharray="0" opacity=".9" />,
  image: <><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.75" /><circle cx="5.5" cy="6" r="1.15" /><path d="m2 12 3.6-3.6 2.4 2.4 2-2 4.25 4.1" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  more: <><circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" /></>,
  chevron: <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />,
  check: <path d="m3.5 8.25 3 3 6-6.5" />,
  "view-glossary": <><path d="M2.5 3.5h7M2.5 6.5h11M2.5 9.5h11M2.5 12.5h6" /><path d="m11 11.5 1.25 1.25 2.25-2.5" /></>,
  "view-text": <path d="M5.25 4.25 2 8l3.25 3.75M10.75 4.25 14 8l-3.25 3.75M9 3 7 13" />,
  "view-preview": <><path d="M1.5 8s2.4-4.75 6.5-4.75S14.5 8 14.5 8 12.1 12.75 8 12.75 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.9" /></>,
  expand: <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.25 6.75M2.5 13.5l4.25-4.25" />,
  collapse: <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4" />,
  upload: <path d="M8 10.75V2.75M4.75 6 8 2.75 11.25 6M2.75 10.5v1.75c0 .55.45 1 1 1h8.5c.55 0 1-.45 1-1V10.5" />,
};

export function EditorIcon({ name, size = 16, className }: { name: EditorIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
