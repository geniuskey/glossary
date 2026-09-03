import { MISSING_TERM_FIELD_LABEL, type TermCompletion } from "@/lib/terms/completion";
import { cx } from "@/lib/ui/format";
import { TERM_QUALITY_PROFILE_LABEL } from "@/lib/workspace/term-quality-values";

export function CompletionBadge({ completion }: { completion: TermCompletion }) {
  return (
    <span
      className={cx(
        "rounded px-2 py-0.5 text-xs font-medium",
        completion.complete ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
      )}
    >
      {completion.complete
        ? `${TERM_QUALITY_PROFILE_LABEL[completion.resolvedProfile]} 기준 충족`
        : `${TERM_QUALITY_PROFILE_LABEL[completion.resolvedProfile]} ${completion.completed}/${completion.total}`}
    </span>
  );
}

export function CompletionProgress({ completion }: { completion: TermCompletion }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-label={`${TERM_QUALITY_PROFILE_LABEL[completion.resolvedProfile]} 기준 충족도`}
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
          {field === "definition" && completion.minimums.definitionMinChars > 1 ? ` ${completion.minimums.definitionMinChars}자 이상` : ""}
          {field === "body" ? ` ${completion.minimums.bodyMinChars}자 이상` : ""}
        </li>
      ))}
    </ul>
  );
}
