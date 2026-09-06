"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { HelpTip } from "@/components/help-tip";
import type { GraphTerm } from "@/lib/terms/query";
import { businessCategoryLabel } from "@/lib/terms/enums";
import { DOMAIN_COLOR_PALETTE, domainColor, domainColorStyle } from "@/lib/terms/domain-colors";
import { displayName } from "@/lib/ui/format";

const WIDTH = 1000;
const HEIGHT = 700;
const HUB_LIMIT = 18;
const TERM_LIMIT = 100;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.5;

type HubKind = "domain" | "category" | "topic";
type NodeKind = HubKind | "term";

export interface GraphNode {
  key: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  term?: GraphTerm;
}

export interface GraphEdge {
  key: string;
  source: string;
  target: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface DragState {
  key: string;
  startX: number;
  startY: number;
  moved: boolean;
}

interface PanState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

// V8(Node)과 브라우저 엔진은 삼각함수의 마지막 부동소수점 자릿수가 다를 수
// 있다. 그 값을 SVG 속성에 그대로 쓰면 서버 HTML과 hydration 첫 렌더가
// 1e-14 정도 어긋난다. 관계도에는 이보다 훨씬 낮은 정밀도면 충분하므로 초기
// 좌표와 출력 좌표를 같은 단위로 양자화한다.
function stableCoordinate(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function termNodeWidth(label: string): number {
  const textWidth = [...label.slice(0, 18)].reduce(
    (width, char) => width + (char.charCodeAt(0) > 127 ? 11 : 6.5),
    0,
  );
  return Math.max(66, Math.min(148, textWidth + 28));
}

function collisionRadius(node: GraphNode): number {
  return node.kind === "term" ? termNodeWidth(node.label) / 2 + 8 : node.radius;
}

// 기본 분류는 색상환에서 충분히 떨어뜨려 한눈에 구분한다. 실제 채도와 명도는
// globals.css가 테마에 맞춰 낮춰 주므로 여기에는 색상 계열만 둔다.
const CATEGORY_HUES: Record<string, number> = {
  product: 215,
  customer: 340,
  project: 275,
  process: 20,
  design: 155,
  evaluation: 45,
  equipment: 185,
  organization: 305,
  system: 235,
  other: 95,
};

// 업무 분류가 비어 있는 기존 데이터도 흰색으로 남지 않게 한다. 현재 화면에
// 보이는 대표 도메인을 정렬한 뒤 서로 충분히 떨어진
// 부드러운 색상 계열을 배정한다. 기본 sort는 UTF-16 코드 단위 기준이라 서버와
// 브라우저에서 같은 결과를 만든다.
const FALLBACK_HUES = DOMAIN_COLOR_PALETTE.map((color) => color.hue);
const DEFAULT_HUE = DOMAIN_COLOR_PALETTE[0]!.hue;

function categoryHue(category: string): number {
  return CATEGORY_HUES[category] ?? hash(`category:${category}`) % 360;
}

function graphColorStyle(hue: number): CSSProperties {
  return { "--graph-category-hue": hue } as CSSProperties;
}

function fallbackColorKey(term: GraphTerm): string {
  const primaryDomain = term.domain.find((domain) => domain.trim().length > 0)?.trim();
  return primaryDomain ? `domain:${primaryDomain}` : "unclassified";
}

function termCategoryKeys(term: GraphTerm): string[] {
  return term.categories.length > 0 ? term.categories : term.category ? [term.category] : [];
}

function termCategoryLabel(term: GraphTerm, category: string): string {
  const index = term.categories.indexOf(category);
  return businessCategoryLabel(
    category,
    index >= 0 ? term.categoryLabels[index] : category === term.category ? term.categoryLabel : undefined,
  );
}

export function buildTermColorHues(
  terms: readonly GraphTerm[],
  domainColors: readonly { label: string; color: string }[] = [],
): ReadonlyMap<string, number> {
  const visibleTerms = terms.slice(0, TERM_LIMIT);
  const configuredDomainHues = new Map(domainColors.map((domain) => [domain.label, domainColor(domain.color).hue]));
  const fallbackKeys = [...new Set(
    visibleTerms.filter((term) => termCategoryKeys(term).length === 0).map(fallbackColorKey),
  )].sort();
  const fallbackHues = new Map(
    fallbackKeys.map((key, index) => [key, FALLBACK_HUES[index % FALLBACK_HUES.length]!]),
  );

  return new Map(visibleTerms.map((term) => [
    term.id,
    termCategoryKeys(term)[0]
      ? categoryHue(termCategoryKeys(term)[0]!)
      : configuredDomainHues.get(term.domain[0] ?? "")
        ?? fallbackHues.get(fallbackColorKey(term))
        ?? DEFAULT_HUE,
  ]));
}

function buildTermColorStyles(
  terms: readonly GraphTerm[],
  domainColors: readonly { label: string; color: string }[],
): ReadonlyMap<string, CSSProperties> {
  const visibleTerms = terms.slice(0, TERM_LIMIT);
  const configured = new Map(domainColors.map((domain) => [domain.label, domainColorStyle(domain.color)]));
  const fallbackKeys = [...new Set(
    visibleTerms.filter((term) => termCategoryKeys(term).length === 0).map(fallbackColorKey),
  )].sort();
  const fallback = new Map(fallbackKeys.map((key, index) => [
    key,
    domainColorStyle(DOMAIN_COLOR_PALETTE[index % DOMAIN_COLOR_PALETTE.length]!.key),
  ]));
  return new Map(visibleTerms.map((term) => {
    const category = termCategoryKeys(term)[0];
    return [
      term.id,
      category
        ? graphColorStyle(categoryHue(category))
        : configured.get(term.domain[0] ?? "") ?? fallback.get(fallbackColorKey(term)) ?? domainColorStyle(null),
    ];
  }));
}

export function buildGraphModel(terms: readonly GraphTerm[]): GraphModel {
  const hubDefs = new Map<string, { label: string; kind: HubKind }>();
  for (const term of terms.slice(0, TERM_LIMIT)) {
    for (const domain of term.domain) hubDefs.set(`d:${domain}`, { label: domain, kind: "domain" });
    for (const category of termCategoryKeys(term)) {
      hubDefs.set(`c:${category}`, {
        label: termCategoryLabel(term, category),
        kind: "category",
      });
    }
    if (term.topic) hubDefs.set(`t:${term.topic}`, { label: term.topic, kind: "topic" });
  }

  const definitions = [...hubDefs.entries()].slice(0, HUB_LIMIT);
  const hubs: GraphNode[] = definitions.map(([key, definition], index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, definitions.length) - Math.PI / 2;
    const radius = definitions.length <= 5 ? 205 : 265;
    return {
      key,
      ...definition,
      x: stableCoordinate(WIDTH / 2 + Math.cos(angle) * radius),
      y: stableCoordinate(HEIGHT / 2 + Math.sin(angle) * radius),
      vx: 0,
      vy: 0,
      radius: definition.kind === "domain" ? 34 : 29,
    };
  });
  const hubKeys = new Set(hubs.map((hub) => hub.key));

  const termNodes: GraphNode[] = terms.slice(0, TERM_LIMIT).map((term, index) => {
    const keys = [
      ...termCategoryKeys(term).map((category) => `c:${category}`),
      ...(term.topic ? [`t:${term.topic}`] : []),
      ...term.domain.map((domain) => `d:${domain}`),
    ].filter((key) => hubKeys.has(key));
    const anchor = hubs.find((hub) => hub.key === keys[0]);
    const seed = hash(term.slug);
    const angle = ((seed % 360) * Math.PI) / 180;
    const distance = 76 + ((seed >>> 8) % 58) + (index % 3) * 7;
    return {
      key: `n:${term.id}`,
      label: displayName(term),
      kind: "term",
      term,
      x: stableCoordinate((anchor?.x ?? WIDTH / 2) + Math.cos(angle) * distance),
      y: stableCoordinate((anchor?.y ?? HEIGHT / 2) + Math.sin(angle) * distance),
      vx: 0,
      vy: 0,
      radius: 12,
    };
  });

  const edges = termNodes.flatMap((node) => {
    const term = node.term!;
    const keys = [
      ...termCategoryKeys(term).map((category) => `c:${category}`),
      ...(term.topic ? [`t:${term.topic}`] : []),
      ...term.domain.map((domain) => `d:${domain}`),
    ].filter((key) => hubKeys.has(key));
    return keys.map((key) => ({ key: `${node.key}:${key}`, source: node.key, target: key }));
  });

  return { nodes: [...hubs, ...termNodes], edges };
}

function simulate(nodes: GraphNode[], edges: readonly GraphEdge[], alpha: number, heldKey: string | null): void {
  const byKey = new Map(nodes.map((node) => [node.key, node]));

  for (const edge of edges) {
    const source = byKey.get(edge.source);
    const target = byKey.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pull = (distance - 105) * 0.0026 * alpha;
    const fx = (dx / distance) * pull;
    const fy = (dy / distance) * pull;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx * 0.48;
    target.vy -= fy * 0.48;
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        const angle = ((hash(`${a.key}:${b.key}`) % 360) * Math.PI) / 180;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }
      const safe = collisionRadius(a) + collisionRadius(b) + 8;
      if (distance > Math.max(150, safe * 2.5)) continue;
      const force = (safe * safe * 0.015 * alpha) / Math.max(distance * distance, 16);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
      if (distance < safe) {
        const overlap = (safe - distance) * 0.035 * alpha;
        a.vx -= (dx / distance) * overlap;
        a.vy -= (dy / distance) * overlap;
        b.vx += (dx / distance) * overlap;
        b.vy += (dy / distance) * overlap;
      }
    }
  }

  for (const node of nodes) {
    const centerStrength = node.kind === "term" ? 0.00028 : 0.0008;
    node.vx += (WIDTH / 2 - node.x) * centerStrength * alpha;
    node.vy += (HEIGHT / 2 - node.y) * centerStrength * alpha;
    node.vx *= 0.84;
    node.vy *= 0.84;
    if (node.key === heldKey) continue;
    // 화면 가장자리는 좌표계의 끝이 아니다. 중심력만으로 군집이 지나치게
    // 흩어지는 것을 막고, 드래그·시뮬레이션 좌표에는 사각형 경계를 두지 않는다.
    node.x += node.vx;
    node.y += node.vy;
  }
}

function kindLabel(kind: NodeKind): string {
  if (kind === "category") return "업무 분류";
  if (kind === "topic") return "주제";
  if (kind === "domain") return "도메인";
  return "용어";
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function TermGraph({
  terms,
  domainColors = [],
}: {
  terms: GraphTerm[];
  domainColors?: { label: string; color: string }[];
}) {
  const model = useMemo(() => buildGraphModel(terms), [terms]);
  const termColorHues = useMemo(() => buildTermColorHues(terms, domainColors), [domainColors, terms]);
  const termColorStyles = useMemo(() => buildTermColorStyles(terms, domainColors), [domainColors, terms]);
  const configuredDomainStyles = useMemo(
    () => new Map(domainColors.map((domain) => [domain.label, domainColorStyle(domain.color)])),
    [domainColors],
  );
  const domainHues = useMemo(() => {
    const configured = new Map(domainColors.map((domain) => [domain.label, domainColor(domain.color).hue]));
    const labels = [...new Set(terms.slice(0, TERM_LIMIT).flatMap((term) => term.domain))].sort();
    let fallbackIndex = 0;
    for (const label of labels) {
      if (configured.has(label)) continue;
      configured.set(label, FALLBACK_HUES[fallbackIndex % FALLBACK_HUES.length] ?? DEFAULT_HUE);
      fallbackIndex += 1;
    }
    return configured;
  }, [domainColors, terms]);
  const [nodes, setNodes] = useState(() => model.nodes.map((node) => ({ ...node })));
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(nodes);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const heatRef = useRef<(alpha?: number) => void>(() => undefined);
  nodesRef.current = nodes;

  useEffect(() => {
    const fresh = model.nodes.map((node) => ({ ...node }));
    nodesRef.current = fresh;
    setNodes(fresh);
    setSelected(null);
    setView({ x: 0, y: 0, scale: 1 });
  }, [model]);

  // SVG viewBox가 컨테이너 크기에 맞춰질 때 생기는 반응형 배율만 역보정한다.
  // 브라우저 크기만 바뀔 때는 노드가 뜻밖에 커지거나 작아지지 않지만, 사용자가
  // 직접 확대·축소하면 노드·글자·연결선이 공간과 함께 자연스럽게 변한다.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.min(entry.contentRect.width / WIDTH, entry.contentRect.height / HEIGHT);
      if (Number.isFinite(next) && next > 0) setCanvasScale(next);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    let alpha = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const tick = () => {
      const next = nodesRef.current.map((node) => ({ ...node }));
      simulate(next, model.edges, alpha, dragRef.current?.key ?? null);
      nodesRef.current = next;
      setNodes(next);
      alpha *= 0.965;
      if (alpha > 0.018 && !reduceMotion) frame = requestAnimationFrame(tick);
      else frame = null;
    };

    heatRef.current = (nextAlpha = 0.72) => {
      alpha = Math.max(alpha, nextAlpha);
      if (reduceMotion) {
        const next = nodesRef.current.map((node) => ({ ...node }));
        for (let i = 0; i < 70; i += 1) {
          simulate(next, model.edges, alpha * (1 - i / 75), dragRef.current?.key ?? null);
        }
        nodesRef.current = next;
        setNodes(next);
      } else if (frame === null) {
        frame = requestAnimationFrame(tick);
      }
    };

    heatRef.current(0.92);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [model]);

  const byKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const neighbors = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const edge of model.edges) {
      const source = result.get(edge.source) ?? new Set<string>();
      const target = result.get(edge.target) ?? new Set<string>();
      source.add(edge.target);
      target.add(edge.source);
      result.set(edge.source, source);
      result.set(edge.target, target);
    }
    return result;
  }, [model.edges]);
  // 마우스가 노드를 스치기만 해도 전체 그래프와 좌상단 정보가 바뀌면 시선이
  // 계속 끊긴다. 강조 상태는 클릭·키보드 선택·드래그로 확정했을 때만 바꾼다.
  const active = selected;
  const activeNode = active ? byKey.get(active) : undefined;
  const activeNeighbors = active ? neighbors.get(active) : undefined;
  const relatedTerms = useMemo(() => activeNeighbors
    ? [...activeNeighbors].map((key) => byKey.get(key)).filter((node): node is GraphNode => node?.kind === "term")
    : [], [activeNeighbors, byKey]);
  const visualNodeScale = 1 / Math.max(0.01, canvasScale);
  const zoomLabel = useMemo(
    () => new Intl.NumberFormat("ko-KR", { style: "percent" }).format(view.scale),
    [view.scale],
  );

  function graphPoint(clientX: number, clientY: number): { x: number; y: number } {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function worldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const point = graphPoint(clientX, clientY);
    return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
  }

  function updateZoom(nextScale: number, around = { x: WIDTH / 2, y: HEIGHT / 2 }) {
    setView((current) => {
      const scale = clampZoom(nextScale);
      const ratio = scale / current.scale;
      return {
        scale,
        x: around.x - (around.x - current.x) * ratio,
        y: around.y - (around.y - current.y) * ratio,
      };
    });
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = graphPoint(event.clientX, event.clientY);
    updateZoom(view.scale * Math.exp(-event.deltaY * 0.0012), point);
  }

  function startNodeDrag(event: ReactPointerEvent<Element>, key: string) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { key, startX: event.clientX, startY: event.clientY, moved: false };
    heatRef.current(0.5);
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest("[data-graph-node]")) return;
    setSelected(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = graphPoint(event.clientX, event.clientY);
    panRef.current = {
      startX: point.x,
      startY: point.y,
      originX: view.x,
      originY: view.y,
    };
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag) {
      const point = worldPoint(event.clientX, event.clientY);
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
      const next = nodesRef.current.map((node) => node.key === drag.key
        ? { ...node, x: point.x, y: point.y, vx: 0, vy: 0 }
        : node);
      nodesRef.current = next;
      setNodes(next);
      heatRef.current(0.32);
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    const point = graphPoint(event.clientX, event.clientY);
    setView((current) => ({
      ...current,
      x: pan.originX + point.x - pan.startX,
      y: pan.originY + point.y - pan.startY,
    }));
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.moved) {
      const draggedKey = dragRef.current.key;
      suppressClickRef.current = draggedKey;
      setSelected(draggedKey);
      window.setTimeout(() => {
        if (suppressClickRef.current === draggedKey) suppressClickRef.current = null;
      }, 0);
    }
    dragRef.current = null;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resetLayout() {
    const fresh = model.nodes.map((node) => ({ ...node }));
    nodesRef.current = fresh;
    setNodes(fresh);
    setView({ x: 0, y: 0, scale: 1 });
    setSelected(null);
    heatRef.current(0.92);
  }

  function resetView() {
    setView({ x: 0, y: 0, scale: 1 });
  }

  if (terms.length === 0) {
    return <div className="card px-5 py-16 text-center text-sm text-ink-3">조건에 맞는 용어가 없습니다.</div>;
  }

  return (
    <section className="card relative flex h-full min-h-[480px] flex-col overflow-hidden bg-panel-2/40 sm:min-h-[560px]">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-12rem)] items-center gap-2 rounded-lg border border-line bg-panel/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <span className="truncate font-medium text-ink">
          {activeNode ? `${kindLabel(activeNode.kind)} · ${activeNode.label}` : `${model.nodes.length}개 노드 · ${model.edges.length}개 연결`}
        </span>
        <HelpTip text="빈 곳을 드래그해 이동하고 휠로 확대·축소합니다. 노드를 드래그해 배치를 바꾸거나 눌러 연결을 강조할 수 있고, 선택한 용어는 아래 상세 보기로 이동합니다." />
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 shadow-sm backdrop-blur">
        <button type="button" className="btn-ghost grid h-9 w-9 place-items-center p-0" aria-label="축소" onClick={() => updateZoom(view.scale / 1.2)}>
          <IconMinus />
        </button>
        <button type="button" className="btn-quiet h-9 min-w-12 px-2 text-[11px] tabular-nums" aria-label={`배율 ${zoomLabel}, 기본 배율로 돌아가기`} onClick={resetView}>
          {zoomLabel}
        </button>
        <button type="button" className="btn-ghost grid h-9 w-9 place-items-center p-0" aria-label="확대" onClick={() => updateZoom(view.scale * 1.2)}>
          <IconPlus />
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-labelledby="term-graph-title term-graph-description"
        className="min-h-[400px] w-full flex-1 cursor-grab touch-none select-none active:cursor-grabbing sm:min-h-[460px]"
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={() => setView({ x: 0, y: 0, scale: 1 })}
      >
        <title id="term-graph-title">도메인, 업무 분류와 주제로 연결한 용어 관계도</title>
        <desc id="term-graph-description">허브와 용어 노드를 드래그할 수 있으며 확대, 축소, 이동과 연결 강조를 지원합니다.</desc>
        <rect width={WIDTH} height={HEIGHT} className="fill-transparent" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="stroke-line-strong" strokeWidth={1.15 / canvasScale}>
            {model.edges.map((edge) => {
              const source = byKey.get(edge.source);
              const target = byKey.get(edge.target);
              if (!source || !target) return null;
              const emphasized = !active || edge.source === active || edge.target === active;
              return (
                <line
                  key={edge.key}
                  x1={stableCoordinate(source.x)}
                  y1={stableCoordinate(source.y)}
                  x2={stableCoordinate(target.x)}
                  y2={stableCoordinate(target.y)}
                  opacity={emphasized ? (active ? 0.82 : 0.36) : 0.07}
                  className="transition-opacity motion-reduce:transition-none"
                />
              );
            })}
          </g>

          {nodes.filter((node) => node.kind !== "term").map((node) => {
            const related = !active || node.key === active || activeNeighbors?.has(node.key);
            const selectedHere = selected === node.key;
            const category = node.kind === "category" ? node.key.slice(2) : null;
            const domain = node.kind === "domain" ? node.key.slice(2) : null;
            const domainHue = domain ? domainHues.get(domain) : undefined;
            const colored = category !== null || domainHue !== undefined;
            return (
              <g
                key={node.key}
                data-graph-node
                transform={`translate(${stableCoordinate(node.x)} ${stableCoordinate(node.y)})`}
                role="button"
                tabIndex={0}
                aria-label={`${kindLabel(node.kind)} ${node.label}, 연결 ${neighbors.get(node.key)?.size ?? 0}개`}
                aria-pressed={selectedHere}
                className="group/hub cursor-grab outline-none active:cursor-grabbing"
                style={category
                  ? graphColorStyle(categoryHue(category))
                  : domain
                    ? configuredDomainStyles.get(domain) ?? (domainHue !== undefined ? graphColorStyle(domainHue) : undefined)
                    : undefined}
                opacity={related ? 1 : 0.18}
                onPointerDown={(event) => startNodeDrag(event, node.key)}
                onFocus={() => setSelected(node.key)}
                onClick={() => {
                  if (suppressClickRef.current === node.key) {
                    suppressClickRef.current = null;
                    return;
                  }
                  setSelected(node.key);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelected(node.key);
                }}
              >
                <g transform={`scale(${visualNodeScale})`}>
                  <circle
                    r={node.radius}
                    className={`${
                      node.kind === "category"
                        ? "graph-category-node"
                        : node.kind === "topic"
                          ? "fill-warn-soft stroke-warn"
                          : domainHue !== undefined ? "graph-category-node" : "fill-panel-2 stroke-line-strong"
                    } group-focus-visible/hub:stroke-[4px]`}
                    strokeWidth={selectedHere ? 3.5 : 2}
                  />
                  <text textAnchor="middle" dy="4" className={`pointer-events-none text-[12px] font-semibold ${colored ? "graph-category-label" : "fill-ink"}`}>
                    {node.label.slice(0, 12)}
                  </text>
                </g>
              </g>
            );
          })}

          {nodes.filter((node) => node.kind === "term").map((node) => {
            const term = node.term!;
            const related = !active || node.key === active || activeNeighbors?.has(node.key);
            const label = node.label.slice(0, 18);
            const width = termNodeWidth(node.label);
            const selectedHere = selected === node.key;
            const termStyle = termColorStyles.get(term.id) ?? graphColorStyle(DEFAULT_HUE);
            return (
              <g
                key={node.key}
                data-graph-node
                role="button"
                tabIndex={0}
                aria-label={`용어 ${node.label}, 연결 ${neighbors.get(node.key)?.size ?? 0}개${term.ownerName ? `, 담당 ${term.ownerName}` : ""}`}
                aria-pressed={selectedHere}
                className="group/term outline-none"
                onPointerDown={(event) => startNodeDrag(event, node.key)}
                onFocus={() => setSelected(node.key)}
                onClick={() => {
                  if (suppressClickRef.current === node.key) {
                    suppressClickRef.current = null;
                    return;
                  }
                  setSelected(node.key);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelected(node.key);
                }}
              >
                <g
                  transform={`translate(${stableCoordinate(node.x)} ${stableCoordinate(node.y)})`}
                  opacity={related ? 1 : 0.14}
                  className="cursor-grab active:cursor-grabbing"
                  style={termStyle}
                >
                  <g transform={`scale(${visualNodeScale})`}>
                    <rect
                      x={-width / 2}
                      y={-14}
                      width={width}
                      height={28}
                      rx={9}
                      className="graph-category-node transition-[stroke-width] group-focus-visible/term:stroke-[3px] motion-reduce:transition-none"
                      strokeWidth={selectedHere ? 3 : 1.5}
                    />
                    <text textAnchor="middle" y="4" className="graph-category-label pointer-events-none text-[11px] font-semibold">
                      {label}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="border-t border-line bg-panel px-4 py-3">
        {activeNode ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="rounded-md bg-brand-soft px-2 py-1 font-medium text-brand">{kindLabel(activeNode.kind)}</span>
            <strong className="min-w-0 truncate text-sm text-ink">{activeNode.label}</strong>
            <span className="text-ink-3">연결 {activeNeighbors?.size ?? 0}개</span>
            {activeNode.kind === "term" && activeNode.term ? (
              <Link href={`/w/${activeNode.term.slug}`} className="rounded font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45">상세 보기</Link>
            ) : relatedTerms.length > 0 ? (
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {relatedTerms.slice(0, 6).map((node) => (
                  <Link key={node.key} href={`/w/${node.term!.slug}`} className="max-w-36 truncate rounded-md border border-line px-2 py-1 text-ink-2 hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45">
                    {node.label}
                  </Link>
                ))}
                {relatedTerms.length > 6 && <span className="text-ink-3">외 {relatedTerms.length - 6}개</span>}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-3">허브를 선택하면 연결된 용어만 강조됩니다. 빈 공간을 드래그해 이동할 수 있습니다.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-3">
          <TermColorLegend hues={[...new Set(domainHues.values())].slice(0, 3)} label="도메인" />
          <LegendDot className="border border-brand bg-brand-soft" label="업무 분류" />
          <LegendDot className="border border-warn bg-warn-soft" label="주제" />
          <TermColorLegend hues={[...new Set(termColorHues.values())].slice(0, 3)} label="용어 · 분류색 우선" />
          <button type="button" className="ml-auto text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={resetLayout}>배치 초기화</button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {activeNode ? `${kindLabel(activeNode.kind)} ${activeNode.label}, 연결 ${neighbors.get(activeNode.key)?.size ?? 0}개` : "전체 관계도"}
      </p>
    </section>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center"><i aria-hidden="true" className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${className}`} />{label}</span>;
}

function TermColorLegend({ hues, label }: { hues: number[]; label: string }) {
  return (
    <span className="inline-flex items-center">
      <span className="mr-1.5 inline-flex -space-x-1" aria-hidden="true">
        {hues.map((hue) => {
          return <i key={hue} className="graph-category-swatch h-2.5 w-2.5 rounded-full border border-panel" style={graphColorStyle(hue)} />;
        })}
      </span>
      {label}
    </span>
  );
}

function IconPlus() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function IconMinus() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5"><path d="M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
