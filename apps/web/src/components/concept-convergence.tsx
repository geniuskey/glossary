"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SURFACE_KIND_LABEL } from "@/lib/terms/enums";
import { cx } from "@/lib/ui/format";

type Surface = { text: string; kind: "abbreviation" | "alias" | "discouraged" | "forbidden" };
type Example = { name: string; nameKo: string; definition: string; domain: string; surfaces: Surface[] };
type Phase = "scatter" | "settled" | "leave";

const EXAMPLES: readonly Example[] = [
  {
    name: "System on Chip",
    nameKo: "시스템 온 칩",
    definition: "여러 기능을 하나의 집적 회로에 구현한 반도체 시스템",
    domain: "반도체",
    surfaces: [
      { text: "SoC", kind: "abbreviation" },
      { text: "시스템온칩", kind: "alias" },
      { text: "원칩 시스템", kind: "discouraged" },
    ],
  },
  {
    name: "Service Level Objective",
    nameKo: "서비스 수준 목표",
    definition: "서비스가 지켜야 할 신뢰성 목표를 측정 가능한 지표로 정한 값",
    domain: "IT",
    surfaces: [
      { text: "SLO", kind: "abbreviation" },
      { text: "서비스 목표치", kind: "alias" },
      { text: "SLA 목표", kind: "forbidden" },
    ],
  },
  {
    name: "Continuous Integration",
    nameKo: "지속적 통합",
    definition: "변경 사항을 자주 합치고 자동으로 빌드·검증하는 개발 방식",
    domain: "IT",
    surfaces: [
      { text: "CI", kind: "abbreviation" },
      { text: "지속 통합", kind: "alias" },
      { text: "자동 빌드", kind: "discouraged" },
    ],
  },
];

// 표기 칩이 카드 안 빈 자리(아직 개념 이름이 없는 위쪽)에 흩어져 있다가 제자리로
// 모인다. 카드 밖으로 나가면 좁은 화면에서 가로 스크롤이 생긴다.
const SCATTER = [
  { x: 150, y: -150, r: -5 },
  { x: -20, y: -205, r: 4 },
  { x: 30, y: -95, r: -3 },
] as const;

const HOLD_MS = 4200;
const SCATTER_MS = 650;
const LEAVE_MS = 380;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** "하나의 개념, 여러 표기" — 이 제품의 축을 설명 대신 움직임으로 보여 준다. */
export function ConceptConvergence() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("settled");
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const running = !paused && !hovered && !reducedMotion;
  // 멈춘 순간이 흩어짐·사라짐 도중이어도 읽을 수 있는 정착 상태를 보여 준다.
  const shown: Phase = running ? phase : "settled";

  useEffect(() => {
    if (!running) return;
    const timer = phase === "scatter"
      ? setTimeout(() => setPhase("settled"), SCATTER_MS)
      : phase === "settled"
        ? setTimeout(() => setPhase("leave"), HOLD_MS)
        : setTimeout(() => {
          setIndex((value) => (value + 1) % EXAMPLES.length);
          setPhase("scatter");
        }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [phase, running]);

  const example = EXAMPLES[index]!;
  const settled = shown === "settled";

  return (
    <div
      className="relative isolate mx-auto w-full max-w-[28rem]"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div aria-hidden className="absolute -inset-3 -z-10 rounded-[1.25rem] border border-line/70 bg-panel-2/60" />
      <figure className="relative overflow-hidden rounded-xl border border-line bg-panel p-6 shadow-[0_18px_50px_-30px_rgb(var(--brand)/0.35)] sm:p-7">
        <figcaption className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-2">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />하나의 개념
          </span>
          <span className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-ink-3">설명용 예시 · {example.domain}</span>
        </figcaption>

        <div
          className="mt-6 min-h-[8.5rem]"
          style={{
            opacity: settled ? 1 : 0,
            transform: settled ? "none" : "translateY(6px)",
            transition: settled ? `opacity 500ms ease 420ms, transform 700ms ${EASE} 420ms` : "opacity 200ms ease",
          }}
        >
          <p className="text-2xl font-bold tracking-[-0.03em] text-ink sm:text-[1.75rem]">{example.name}</p>
          <p className="mt-1 text-sm font-medium text-ink-2">{example.nameKo}</p>
          <p className="mt-4 border-l-2 border-brand/50 pl-3 text-sm leading-6 text-ink-2">{example.definition}</p>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[11px] text-ink-3">어떤 표기로 찾아도 여기로 모입니다</p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {example.surfaces.map((surface, slot) => {
              const offset = SCATTER[slot % SCATTER.length]!;
              return (
                <li
                  key={`${index}:${surface.text}`}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs",
                    surface.kind === "abbreviation" && "bg-brand-soft font-semibold text-brand",
                    surface.kind === "alias" && "bg-panel-2 text-ink-2",
                    (surface.kind === "discouraged" || surface.kind === "forbidden") && "border border-dashed border-line-strong text-ink-3",
                  )}
                  style={{
                    opacity: shown === "leave" ? 0 : 1,
                    transform: shown === "scatter" ? `translate(${offset.x}px, ${offset.y}px) rotate(${offset.r}deg)` : "none",
                    transition: settled
                      ? `transform 900ms ${EASE} ${slot * 90}ms, opacity 300ms ease`
                      : `opacity ${LEAVE_MS}ms ease`,
                  }}
                >
                  <span className={cx((surface.kind === "discouraged" || surface.kind === "forbidden") && "line-through decoration-danger/60")}>{surface.text}</span>
                  <span className="ml-1.5 text-[10px] font-normal opacity-75">{SURFACE_KIND_LABEL[surface.kind]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </figure>

      <div className="mt-4 flex items-center justify-center gap-3">
        <div className="flex items-center gap-1.5">
          {EXAMPLES.map((item, slot) => (
            <button
              key={item.name}
              type="button"
              onClick={() => {
                setIndex(slot);
                setPhase("settled");
              }}
              aria-label={`예시 ${slot + 1}: ${item.name}`}
              aria-current={slot === index ? "true" : undefined}
              className="grid h-6 w-6 place-items-center rounded-full"
            >
              <span className={cx("h-1.5 rounded-full transition-all", slot === index ? "w-4 bg-brand" : "w-1.5 bg-line-strong")} />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? "예시 자동 넘김 재생" : "예시 자동 넘김 일시정지"}
          className="btn-quiet h-7 w-7 p-0 motion-reduce:hidden"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            {paused ? <path d="m4 2 6 4-6 4Z" /> : <path d="M3 2h2v8H3zm4 0h2v8H7z" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
