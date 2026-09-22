"use client";

import { useEffect, useRef, useState } from "react";

/** A bounded, analytical flow field: no particle simulation or all-pairs checks. */
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
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
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
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, active: false };

    function colors() {
      const style = getComputedStyle(document.documentElement);
      brand = style.getPropertyValue("--brand").trim();
      accent = style.getPropertyValue("--accent").trim();
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const rows = width < 640 ? 16 : 25;
      const steps = Math.min(100, Math.ceil(width / 18));
      const radius = Math.min(260, width * 0.4);
      // Two interfering waves form a silk-like ribbon; the cursor bends it locally.
      const point = (u: number, row: number) => {
        const x = u * width;
        const envelope = Math.sin(u * Math.PI);
        const y = height * (0.61 + (row / (rows - 1) - 0.5) * 0.38)
          + Math.sin(u * 7.5 + time * 0.22 + row * 0.105) * height * 0.13 * envelope
          + Math.cos(u * 12 - time * 0.16 + row * 0.16) * height * 0.035 * envelope;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const influence = Math.exp(-(dx * dx + dy * dy) / (radius * radius)) * pointer.strength;
        return [x + dy * influence * 0.2, y - dx * influence * 0.32] as const;
      };
      for (let row = 0; row < rows; row++) {
        const color = row % 7 === 0 ? accent : brand;
        context.beginPath();
        for (let step = 0; step <= steps; step++) {
          const [x, y] = point(step / steps, row);
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.lineWidth = row % 5 === 0 ? 1 : 0.65;
        context.strokeStyle = `rgb(${color} / ${row % 5 === 0 ? 0.22 : 0.11})`;
        context.stroke();
        // Two small travelling lights per strand, with deterministic spacing.
        for (let dot = 0; dot < 2; dot++) {
          const u = (row * 0.137 + dot * 0.5 + time * (0.012 + row % 3 * 0.002)) % 1;
          const [x, y] = point(u, row);
          const alpha = Math.sin(u * Math.PI) * 0.55;
          context.fillStyle = `rgb(${color} / ${alpha * 0.12})`;
          context.beginPath();
          context.arc(x, y, 5, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = `rgb(${color} / ${alpha})`;
          context.beginPath();
          context.arc(x, y, row % 4 === 0 ? 1.8 : 1.2, 0, Math.PI * 2);
          context.fill();
        }
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
      if (!canvas || !context) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      // Cap both pixel density and backing-store area on large/retina displays.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_400_000 / (width * height)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function move(event: PointerEvent) {
      if (!visible || pausedRef.current || motion.matches || event.pointerType === "touch") return;
      const rect = canvas!.getBoundingClientRect();
      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = event.clientY - rect.top;
      pointer.active = pointer.targetY >= 0 && pointer.targetY <= height;
    }
    function leave() { pointer.active = false; }
    function recolor() { colors(); draw(); }

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
        aria-label={paused ? "배경 움직임 재생" : "배경 움직임 일시정지"}
        aria-pressed={paused}
        className="pointer-events-auto absolute bottom-5 right-5 z-20 flex min-h-11 items-center gap-2 rounded-full border border-line/60 bg-paper/80 px-3 text-[11px] text-ink-3 transition hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:hidden sm:right-8"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          {paused ? <path d="m4 2 6 4-6 4Z" /> : <path d="M3 2h2v8H3zm4 0h2v8H7z" />}
        </svg>
        <span>고요한 흐름</span>
      </button>
    </div>
  );
}
