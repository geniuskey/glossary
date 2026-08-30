import { MISSING_TERM_FIELD_LABEL, type TermCompletion } from "@/lib/terms/completion";
import { cx } from "@/lib/ui/format";

export function CompletionBadge({ completion }: { completion: TermCompletion }) {
  return (
    <span
      className={cx(
        "rounded px-2 py-0.5 text-xs font-medium",
        completion.complete ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
      )}
    >
      {completion.complete ? "핵심 정보 정리됨" : `정리 ${completion.completed}/${completion.total}`}
    </span>
  );
}

export function CompletionProgress({ completion }: { completion: TermCompletion }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-label="용어 핵심 정보 완성도"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={completion.percent}
    >
      <span className="block h-full rounded-full bg-brand" style={{ width: `${completion.percent}%` }} />
    </div>
  );
}

export function MissingFields({ completion }: { completion: TermCompletion }) {
  if (completion.complete) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="아직 필요한 정보">
      {completion.missing.map((field) => (
        <li key={field} className="chip border-warn/30 bg-warn-soft text-warn">
          {MISSING_TERM_FIELD_LABEL[field]}
        </li>
      ))}
    </ul>
  );
}
