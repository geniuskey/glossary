export function HelpTip({ text }: { text: string }) {
  return (
    <span className="group/help-tip relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`도움말: ${text}`}
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line-strong bg-panel text-[10px] font-semibold leading-none text-ink-3 shadow-sm transition hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-max max-w-72 rounded-lg border border-line-strong bg-ink px-2.5 py-2 text-left text-[11px] font-normal leading-5 text-paper opacity-0 shadow-pop transition-opacity group-hover/help-tip:opacity-100 group-focus-within/help-tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
