"use client";

import { useEffect, useRef, useState } from "react";

const KEYWORDS = [
  "용어집",
  "Glossary",
  "팀의 언어",
  "표준화",
  "검색",
  "정의",
  "약어",
  "별칭",
  "금지어",
  "문서화",
  "협업",
  "지식",
  "도메인",
  "분류",
  "그래프",
  "회의",
  "위키",
  "API",
  "RAG",
  "Context",
  "Knowledge",
  "Ontology",
  "Terms",
  "Search",
  "대표 표기",
  "사용 지침",
  "한줄 정의",
  "동의어",
  "비권장",
  "상태",
  "변경 이력",
  "기여",
  "검토",
  "소유자",
  "태그",
  "분야",
  "표기",
  "문맥",
  "근거",
  "질의",
  "답변",
  "임베딩",
  "검색어",
  "시트",
  "챗",
  "통계",
  "가져오기",
  "내보내기",
  "슬러그",
  "마크다운",
  "API 키",
  "팀 지식",
  "공유",
  "신뢰",
  "정확성",
  "발견",
  "연결",
  "관계",
  "개념",
  "의미",
  "언어",
  "스키마",
  "데이터",
  "회고",
  "온보딩",
  "기억",
  "명료함",
  "운영",
  "워크스페이스",
  "Knowledge Base",
  "Semantic Search",
];

type FloatingGlyph = {
  word: string;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  phase: number;
  speed: number;
  driftX: number;
  driftY: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  colorIndex: number;
  vx: number;
  vy: number;
};

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.173 + salt * 17.37) * 43758.5453;
  return value - Math.floor(value);
}

/** A deterministic Korean/Latin keyword cloud with pointer repulsion. */
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

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const theme = window.matchMedia("(prefers-color-scheme: dark)");
    const coarse = window.matchMedia("(pointer: coarse)");
    let width = 1;
    let height = 1;
    let visible = false;
    let frame = 0;
    let last = 0;
    let time = 0;
    let brand = "";
    let accent = "";
    let ink = "";
    let glyphs: FloatingGlyph[] = [];
    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      strength: 0,
      impact: 0,
      active: false,
    };

    function colors() {
      const style = getComputedStyle(document.documentElement);
      brand = style.getPropertyValue("--brand").trim();
      accent = style.getPropertyValue("--accent").trim();
      ink = style.getPropertyValue("--ink-3").trim();
    }

    function createGlyphs() {
      const count = width < 640 ? 30 : Math.min(KEYWORDS.length, Math.max(48, Math.round(width / 30)));
      const columns = width < 640 ? 3 : Math.max(6, Math.min(10, Math.round(width / 160)));
      const rows = Math.ceil(count / columns);
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      glyphs = Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const jitterX = (seeded(index, 1) - 0.5) * cellWidth * 0.12;
        const jitterY = (seeded(index, 2) - 0.5) * cellHeight * 0.12;
        const baseX = (column + 0.5) * cellWidth + jitterX;
        const baseY = (row + 0.5) * cellHeight + jitterY;
        const desiredSize = (width < 640 ? 34 : 42) + seeded(index, 3) * (width < 640 ? 24 : 42);
        const word = KEYWORDS[(index * 17) % KEYWORDS.length] ?? "Glossary";
        context.font = `900 ${desiredSize}px "Arial Black", "Noto Sans KR Variable", "Noto Sans KR", sans-serif`;
        const measuredWidth = context.measureText(word).width;
        const widthLimit = cellWidth * 0.7;
        const heightLimit = cellHeight * 0.52;
        // Fit each word inside its own grid cell so the cloud stays readable while moving.
        const size = Math.min(desiredSize, desiredSize * widthLimit / Math.max(1, measuredWidth), heightLimit);
        return {
          word,
          x: baseX,
          y: baseY,
          baseX,
          baseY,
          size,
          phase: seeded(index, 5) * Math.PI * 2,
          speed: 0.28 + seeded(index, 6) * 0.36,
          driftX: (width < 640 ? 4 : 7) + seeded(index, 7) * (width < 640 ? 7 : 13),
          driftY: (width < 640 ? 4 : 6) + seeded(index, 8) * (width < 640 ? 7 : 11),
          rotation: (seeded(index, 9) - 0.5) * 0.16,
          rotationSpeed: (seeded(index, 10) - 0.5) * 0.08,
          opacity: 0.075 + seeded(index, 11) * 0.085,
          colorIndex: Math.floor(seeded(index, 12) * 3),
          vx: 0,
          vy: 0,
        } satisfies FloatingGlyph;
      });
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "bevel";

      for (const glyph of glyphs) {
        const color = glyph.colorIndex === 0 ? brand : glyph.colorIndex === 1 ? accent : ink;
        const pulse = 0.82 + Math.sin(time * glyph.speed + glyph.phase) * 0.18;
        context.save();
        context.translate(glyph.x, glyph.y);
        context.rotate(glyph.rotation);
        context.font = `900 ${glyph.size}px "Arial Black", "Noto Sans KR Variable", "Noto Sans KR", sans-serif`;
        context.fillStyle = `rgb(${color} / ${glyph.opacity * pulse})`;
        context.fillText(glyph.word, 0, 0);
        context.restore();
      }
    }

    function tick(now: number) {
      const interval = coarse.matches ? 1000 / 24 : 1000 / 30;
      if (now - last >= interval) {
        const elapsed = last ? Math.min((now - last) / 1000, 0.1) : interval / 1000;
        last = now;
        time += elapsed;
        const ease = 1 - Math.exp(-elapsed * 5);
        pointer.x += (pointer.targetX - pointer.x) * ease;
        pointer.y += (pointer.targetY - pointer.y) * ease;
        pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * ease;
        pointer.impact *= Math.pow(0.02, elapsed);

        for (const glyph of glyphs) {
          const targetX = glyph.baseX + Math.sin(time * glyph.speed + glyph.phase) * glyph.driftX;
          const targetY = glyph.baseY + Math.cos(time * glyph.speed * 0.83 + glyph.phase) * glyph.driftY;
          glyph.vx += (targetX - glyph.x) * 1.3 * elapsed;
          glyph.vy += (targetY - glyph.y) * 1.3 * elapsed;
          const dx = glyph.x - pointer.x;
          const dy = glyph.y - pointer.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const radius = 145 + glyph.size * 1.4;
          if (pointer.active && distance < radius) {
            const force = Math.pow(1 - distance / radius, 2) * (520 + pointer.impact * 680) * pointer.strength;
            glyph.vx += (dx / distance) * force * elapsed;
            glyph.vy += (dy / distance) * force * elapsed;
          }
          const drag = Math.pow(0.09, elapsed);
          glyph.vx *= drag;
          glyph.vy *= drag;
          glyph.vx = Math.max(-260, Math.min(260, glyph.vx));
          glyph.vy = Math.max(-260, Math.min(260, glyph.vy));
          glyph.x += glyph.vx * elapsed;
          glyph.y += glyph.vy * elapsed;
          glyph.rotation += glyph.rotationSpeed * elapsed;
        }
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && !document.hidden && !motion.matches && !pausedRef.current) {
        frame = requestAnimationFrame(tick);
      }
      draw();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_400_000 / (width * height)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      createGlyphs();
      draw();
    }

    function move(event: PointerEvent) {
      if (!visible || pausedRef.current || motion.matches || event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      const nextX = event.clientX - rect.left;
      const nextY = event.clientY - rect.top;
      const jump = Math.hypot(nextX - pointer.targetX, nextY - pointer.targetY);
      pointer.targetX = nextX;
      pointer.targetY = nextY;
      pointer.active = nextX >= 0 && nextX <= width && nextY >= 0 && nextY <= height;
      pointer.impact = Math.min(1, pointer.impact + jump / 120);
    }
    function leave() {
      pointer.active = false;
      pointer.impact = 0;
    }
    function recolor() {
      colors();
      draw();
    }

    colors();
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
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    theme.addEventListener("change", recolor);
    return () => {
      cancelAnimationFrame(frame);
      syncRef.current = null;
      sizing.disconnect();
      visibility.disconnect();
      themeChanges.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      theme.removeEventListener("change", recolor);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 h-[calc(100svh-3.5rem)] min-h-[440px]">
      <canvas ref={canvasRef} aria-hidden="true" className="home-flow-canvas h-full w-full" />
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? "배경 문자 움직임 재생" : "배경 문자 움직임 일시정지"}
        aria-pressed={paused}
        className="pointer-events-auto absolute bottom-5 right-5 z-20 flex min-h-11 items-center gap-2 rounded-full border border-line/60 bg-paper/80 px-3 text-[11px] text-ink-3 transition hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:hidden sm:right-8"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          {paused ? <path d="m4 2 6 4-6 4Z" /> : <path d="M3 2h2v8H3zm4 0h2v8H7z" />}
        </svg>
        <span>문자장</span>
      </button>
    </div>
  );
}
