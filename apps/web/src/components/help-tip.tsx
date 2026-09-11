"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function HelpTip({ text }: { text: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);

  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.bottom > window.innerHeight - 160;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      above,
    });
  }

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node)) close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [position]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={trigger}
        type="button"
        aria-label={`도움말: ${text}`}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        onClick={show}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong bg-panel text-[11px] font-semibold leading-none text-ink-3 shadow-sm transition-colors hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        ?
      </button>
      {position && createPortal(<span
        id={id}
        role="tooltip"
        style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}
        className="pointer-events-none fixed z-[100] w-max max-w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-line-strong bg-ink px-3 py-2 text-left text-xs font-normal leading-5 text-paper shadow-pop"
      >
        {text}
      </span>, document.body)}
    </span>
  );
}
