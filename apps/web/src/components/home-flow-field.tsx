"use client";

import { useEffect, useRef, useState } from "react";

type CoreWord = {
  label: string;
  lane: number;
  start: number;
  speed: number;
  emphasis?: boolean;
};

const CORE_LABELS = [
  "용어", "개념", "표기", "정의", "검색", "검증", "관계", "위키", "협업", "RAG",
  "표준화", "단일 사전", "대표 표기", "별칭", "약어", "도메인", "문맥", "분류", "사용 지침", "변경 이력",
  "발견", "등록", "정리", "검토", "기여", "제안", "공유", "가져오기", "문서 검사", "의미 검색",
  "정규화", "중복 탐지", "미등록 후보", "지식 그래프", "임베딩", "리비전", "OpenAPI", "자동 교정", "하이브리드 검색", "기계 판독",
];

const EMPHASIZED_WORDS = new Set(["용어", "정의", "협업", "표준화", "단일 사전", "기계 판독"]);
const FLOW_SPAN = 2.8;
const CORE_WORDS: readonly CoreWord[] = CORE_LABELS.map((label, index) => ({
  label,
  lane: (index * 7 + 1) % 13,
  start: (0.08 + index * 0.67) % FLOW_SPAN,
  speed: 0.0105 + (index % 5) * 0.0008,
  emphasis: EMPHASIZED_WORDS.has(label),
}));

function laneY(x: number, lane: number, time: number, width: number, height: number, laneCount: number) {
  const progress = x / Math.max(1, width);
  const base = height * (0.08 + (lane / Math.max(1, laneCount - 1)) * 0.84);
  const broadCurrent = Math.sin(progress * Math.PI * 2.1 + lane * 0.62 + time * 0.1) * (7 + lane % 3 * 2);
  const fineCurrent = Math.sin(progress * Math.PI * 4.2 - lane * 0.37 - time * 0.065) * 3.5;
  return base + broadCurrent + fineCurrent;
}

/** Project keywords carried through a field of slow, river-like streamlines. */
export function HomeFlowField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current?.();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    let width = 1;
    let height = 1;
    let visible = false;
    let frame = 0;
    let last = 0;
    let time = 0;
    let brand = "";
    let ink = "";
    let paper = "";

    function readColors() {
      const style = getComputedStyle(document.documentElement);
      brand = style.getPropertyValue("--brand").trim();
      ink = style.getPropertyValue("--ink-3").trim();
      paper = style.getPropertyValue("--paper").trim();
    }

    function traceLane(lane: number, laneCount: number) {
      context.beginPath();
      for (let x = -12; x <= width + 12; x += 12) {
        const y = laneY(x, lane, time, width, height, laneCount);
        if (x === -12) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
    }

    function drawStreamlines(laneCount: number) {
      for (let lane = 0; lane < laneCount; lane += 1) {
        const foreground = lane % 3 === 1;

        context.setLineDash([]);
        context.lineWidth = foreground ? 0.9 : 0.65;
        context.strokeStyle = `rgb(${foreground ? brand : ink} / ${foreground ? 0.105 : 0.07})`;
        traceLane(lane, laneCount);
        context.stroke();

        context.setLineDash([foreground ? 42 : 28, foreground ? 126 : 148]);
        context.lineDashOffset = -time * (foreground ? 17 : 11) - lane * 23;
        context.lineWidth = foreground ? 1.25 : 0.9;
        context.strokeStyle = `rgb(${brand} / ${foreground ? 0.19 : 0.105})`;
        traceLane(lane, laneCount);
        context.stroke();
      }
      context.setLineDash([]);
    }

    function drawWords(laneCount: number) {
      const mobile = width < 640;
      for (let index = 0; index < CORE_WORDS.length; index += 1) {
        const word = CORE_WORDS[index]!;
        const progress = (word.start + time * word.speed) % FLOW_SPAN - 0.9;
        const x = progress * width;
        const mappedLane = mobile ? word.lane % laneCount : word.lane;
        const y = laneY(x, mappedLane, time, width, height, laneCount);
        const longLabel = word.label.length > 5;
        const size = mobile ? (word.emphasis ? 14 : longLabel ? 12 : 13) : word.emphasis ? 18 : longLabel ? 13 : 15;

        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `${word.emphasis ? 650 : 560} ${size}px "Noto Sans KR Variable", "Noto Sans KR", sans-serif`;
        context.lineJoin = "round";
        context.lineWidth = mobile ? 4 : 5;
        context.strokeStyle = `rgb(${paper} / 0.82)`;
        context.strokeText(word.label, x, y);
        context.fillStyle = `rgb(${word.emphasis ? brand : ink} / ${word.emphasis ? 0.52 : 0.4})`;
        context.fillText(word.label, x, y);
      }
    }

    function draw() {
      const laneCount = width < 640 ? 8 : 13;
      context.clearRect(0, 0, width, height);
      drawStreamlines(laneCount);
      drawWords(laneCount);
    }

    function tick(now: number) {
      const interval = coarsePointer.matches ? 1000 / 20 : 1000 / 30;
      if (now - last >= interval) {
        const elapsed = last ? Math.min((now - last) / 1000, 0.1) : interval / 1000;
        last = now;
        time += elapsed;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && !document.hidden && !reducedMotion.matches && !pausedRef.current) {
        frame = requestAnimationFrame(tick);
      }
      draw();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_200_000 / (width * height)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function recolor() {
      readColors();
      draw();
    }

    readColors();
    syncRef.current = sync;
    const sizing = new ResizeObserver(resize);
    sizing.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    visibility.observe(canvas);
    const themeChanges = new MutationObserver(recolor);
    themeChanges.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);

    return () => {
      cancelAnimationFrame(frame);
      syncRef.current = null;
      sizing.disconnect();
      visibility.disconnect();
      themeChanges.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 h-[calc(100svh-3.5rem)] min-h-[440px] overflow-hidden">
      <canvas ref={canvasRef} aria-hidden="true" className="home-flow-canvas h-full w-full" />
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? "배경 모션 재생" : "배경 모션 일시정지"}
        aria-pressed={paused}
        className="pointer-events-auto absolute bottom-5 right-5 z-20 flex min-h-11 items-center gap-2 rounded-full border border-line/60 bg-paper/75 px-3 text-[11px] text-ink-3 shadow-sm backdrop-blur-md transition hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:hidden sm:right-8"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          {paused ? <path d="m4 2 6 4-6 4Z" /> : <path d="M3 2h2v8H3zm4 0h2v8H7z" />}
        </svg>
        <span>배경 모션</span>
      </button>
    </div>
  );
}
