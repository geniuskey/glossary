import { TERM_STATUS_LABEL, type TermStatusLiteral } from "@/lib/terms/enums";
import { cx } from "@/lib/ui/format";

// F6/P1(query.ts의 규약): lookup 테이블은 `Record<유니온, T>`로 선언하고 `??`
// 폴백을 두지 않는다 — 폴백이 있으면 DB enum에 값이 추가돼도 tsc가 조용히
// 통과시켜 화면만 어긋난다. 라벨은 enums.ts의 TERM_STATUS_LABEL 하나만 쓴다
// (여기 두 번째 사본이 있으면 그게 곧 드리프트의 출처가 된다).
export const STATUS_TONE: Record<TermStatusLiteral, string> = {
  draft: "bg-brand-soft text-brand",
  active: "bg-ok-soft text-ok",
  deprecated: "bg-warn-soft text-warn",
  forbidden: "bg-danger-soft text-danger",
};

export function StatusBadge({ status, className }: { status: TermStatusLiteral; className?: string }) {
  return (
    <span className={cx("rounded px-2 py-0.5 text-xs font-medium", STATUS_TONE[status], className)}>
      {TERM_STATUS_LABEL[status]}
    </span>
  );
}

export function DomainBadges({ domain }: { domain: string[] }) {
  if (domain.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {domain.map((d) => (
        <span key={d} className="chip">
          {d}
        </span>
      ))}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return <span className="chip border-brand/25 bg-brand-soft/60 text-brand">분류 · {category}</span>;
}

export function OwnerBadge({ ownerName, mine = false }: { ownerName: string | null; mine?: boolean }) {
  if (!ownerName) return <span className="chip text-ink-3">담당자 미지정</span>;
  return <span className={cx("chip", mine && "chip-on")}>{mine ? "내 담당" : `담당 · ${ownerName}`}</span>;
}
