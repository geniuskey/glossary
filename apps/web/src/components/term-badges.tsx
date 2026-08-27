const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  approved: "승인됨",
  deprecated: "폐기됨",
  forbidden: "금지어",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-800",
  deprecated: "bg-amber-100 text-amber-800",
  forbidden: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.draft}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function DomainBadges({ domain }: { domain: string[] }) {
  if (domain.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {domain.map((d) => (
        <span key={d} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {d}
        </span>
      ))}
    </span>
  );
}
