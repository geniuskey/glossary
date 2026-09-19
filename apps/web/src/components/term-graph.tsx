"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { HelpTip } from "@/components/help-tip";
import type { GraphTerm } from "@/lib/terms/query";
import { businessCategoryLabel } from "@/lib/terms/enums";
import { DOMAIN_COLOR_PALETTE, domainColor, domainColorStyle } from "@/lib/terms/domain-colors";
import { displayName } from "@/lib/ui/format";
import { RELATION_LABEL, type SemanticRelation } from "@/lib/terms/relation-values";

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
  relation?: SemanticRelation;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  omittedHubCount: number;
  omittedEdgeCount: number;
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

export function termRelations(term: GraphTerm): { key: string; label: string; kind: HubKind }[] {
  return [...new Map([
    ...term.domain.map((label) => ({ key: `d:${label}`, label, kind: "domain" as const })),
    ...termCategoryKeys(term).map((category) => ({ key: `c:${category}`, label: termCategoryLabel(term, category), kind: "category" as const })),
    ...(term.topic ? [{ key: `t:${term.topic}`, label: term.topic, kind: "topic" as const }] : []),
  ].map((relation) => [relation.key, relation])).values()];
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
    const keys = termRelations(term).map((relation) => relation.key).filter((key) => hubKeys.has(key));
    return keys.map((key) => ({ key: `${node.key}:${key}`, source: node.key, target: key }));
  });

  const omittedEdgeCount = terms.slice(0, TERM_LIMIT).reduce(
    (count, term) => count + termRelations(term).filter((relation) => !hubKeys.has(relation.key)).length, 0,
  );
  return { nodes: [...hubs, ...termNodes], edges, omittedHubCount: hubDefs.size - hubs.length, omittedEdgeCount };
}

export function buildSemanticGraphModel(terms: readonly GraphTerm[], relations: readonly SemanticRelation[]): GraphModel {
  const nodes = terms.slice(0, TERM_LIMIT).map((term, index): GraphNode => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const distance = 35 * Math.sqrt(index);
    return { key: `n:${term.id}`, label: displayName(term), kind: "term", term, radius: 12, vx: 0, vy: 0,
      x: stableCoordinate(WIDTH / 2 + Math.cos(angle) * distance), y: stableCoordinate(HEIGHT / 2 + Math.sin(angle) * distance) };
  });
  const ids = new Set(nodes.map((node) => node.term!.id));
  const edges = relations.filter((relation) => ids.has(relation.sourceTermId) && ids.has(relation.targetTermId))
    .map((relation) => ({ key: relation.id, source: `n:${relation.sourceTermId}`, target: `n:${relation.targetTermId}`, relation }));
  return { nodes, edges, omittedHubCount: 0, omittedEdgeCount: relations.length - edges.length };
}

const NO_RELATIONS: SemanticRelation[] = [];

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

export function fitGraphView(nodes: readonly GraphNode[], canvasScale = 1): ViewTransform {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };
  const visualScale = 1 / Math.max(0.01, canvasScale);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const node of nodes) {
    // Include labels as well as node shapes in the fitted bounds.
    const halfWidth = (node.kind === "term" ? termNodeWidth(node.label) / 2 : Math.max(node.radius, node.label.slice(0, 12).length * 6)) * visualScale;
    const halfHeight = (node.kind === "term" ? 14 : node.radius) * visualScale;
    left = Math.min(left, node.x - halfWidth);
    right = Math.max(right, node.x + halfWidth);
    top = Math.min(top, node.y - halfHeight);
    bottom = Math.max(bottom, node.y + halfHeight);
  }
  const scale = Math.min(MAX_ZOOM, (WIDTH - 80) / Math.max(1, right - left), (HEIGHT - 80) / Math.max(1, bottom - top));
  return { x: WIDTH / 2 - (left + right) / 2 * scale, y: HEIGHT / 2 - (top + bottom) / 2 * scale, scale };
}

export function TermGraph({
  terms,
  domainColors = [],
  semanticRelations = NO_RELATIONS,
  mode = "classification",
  onSelectTerm,
  topBar,
}: {
  terms: GraphTerm[];
  domainColors?: { label: string; color: string }[];
  semanticRelations?: SemanticRelation[];
  mode?: "classification" | "semantic";
  onSelectTerm?: (term: { id: string; name: string } | null) => void;
  topBar?: ReactNode;
}) {
  const model = useMemo(() => mode === "semantic" ? buildSemanticGraphModel(terms, semanticRelations) : buildGraphModel(terms), [terms, mode, semanticRelations]);
  const markerId = useId().replace(/:/g, "");
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
  const categoryHues = useMemo(() => [...new Set(model.nodes
    .filter((node) => node.kind === "category")
    .map((node) => categoryHue(node.key.slice(2))))].slice(0, 3), [model.nodes]);
  const [nodes, setNodes] = useState(() => model.nodes.map((node) => ({ ...node })));
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const focusDetailsRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(nodes);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const heatRef = useRef<(alpha?: number) => void>(() => undefined);
  nodesRef.current = nodes;

  useEffect(() => {
    if (focusDetailsRef.current) {
      detailsRef.current?.focus();
      focusDetailsRef.current = false;
    }
  }, [selected]);

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
  }, [terms.length === 0]);

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
  const edgeLanes = useMemo(() => {
    const groups = new Map<string, GraphEdge[]>();
    for (const edge of model.edges) {
      const key = [edge.source, edge.target].sort().join("|");
      const group = groups.get(key) ?? [];
      group.push(edge);
      groups.set(key, group);
    }
    return new Map([...groups.values()].flatMap((group) => group.map((edge, index) => [edge.key, index - (group.length - 1) / 2] as const)));
  }, [model.edges]);
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
  const activeRelations = activeNode?.term ? termRelations(activeNode.term) : [];
  const selectedEdges = model.edges.filter((edge) => edge.source === active || edge.target === active);
  const activeConnectionCount = mode === "semantic" ? selectedEdges.length : activeNode?.term ? activeRelations.length : activeNeighbors?.size ?? 0;
  useEffect(() => {
    onSelectTerm?.(activeNode?.term ? { id: activeNode.term.id, name: activeNode.label } : null);
  }, [activeNode?.term?.id, activeNode?.label, onSelectTerm]);
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
      const scale = Math.max(Math.min(MIN_ZOOM, current.scale), Math.min(MAX_ZOOM, nextScale));
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

  function fitView() {
    setView(fitGraphView(nodesRef.current, canvasScale));
  }

  function focusNode(node: GraphNode) {
    setFocused(node.key);
    if (dragRef.current) return;
    const x = node.x * view.scale + view.x;
    const y = node.y * view.scale + view.y;
    const inset = Math.max(80, collisionRadius(node) * visualNodeScale * view.scale);
    if (x < inset || x > WIDTH - inset || y < inset || y > HEIGHT - inset) {
      setView((current) => ({ ...current, x: WIDTH / 2 - node.x * current.scale, y: HEIGHT / 2 - node.y * current.scale }));
    }
  }

  function selectWithKeyboard(event: ReactKeyboardEvent<SVGGElement>, key: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (selected === key) detailsRef.current?.focus();
    else {
      focusDetailsRef.current = true;
      setSelected(key);
    }
  }

  function handleGraphKey(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50],
    };
    const offset = offsets[event.key];
    if (offset) {
      event.preventDefault();
      setView((current) => ({ ...current, x: current.x + offset[0], y: current.y + offset[1] }));
    } else if (event.key === "Home") {
      event.preventDefault();
      fitView();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSelected(null);
    }
  }

  if (terms.length === 0) {
    return (
      <section className="flex h-full min-h-[480px] flex-col">
        {topBar && (
          <div className="graph-toolbar-shell flex min-w-0 shrink-0 items-center justify-end gap-1.5 border-b border-line px-3 py-1.5">{topBar}</div>
        )}
        <div className="grid min-h-0 flex-1 place-items-center px-5 py-16 text-center text-sm text-ink-3">조건에 맞는 용어가 없습니다.</div>
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-[480px] flex-col overflow-hidden sm:min-h-[560px]">
      <div className="graph-toolbar-shell relative z-20 flex min-w-0 shrink-0 items-center gap-x-3 border-b border-line px-3 py-1.5">
        <div className="graph-toolbar-status flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className="truncate font-medium text-ink">
            {activeNode ? `${kindLabel(activeNode.kind)} · ${activeNode.label}` : `${model.nodes.length}개 노드 · ${model.edges.length}개 연결`}
          </span>
          <HelpTip text={mode === "semantic" ? "화살표는 출발 용어에서 도착 용어를 향합니다. 노드를 선택하면 오른쪽 상세 패널에서 관계의 종류와 근거를 확인하고 아래 관리 목록에서 검토할 수 있습니다. 키보드: 방향키로 이동, Home 전체 맞춤, Escape로 선택 해제합니다." : "빈 곳을 드래그해 이동하고 휠로 확대·축소합니다. 노드를 드래그해 배치를 바꾸거나 눌러 연결을 강조할 수 있고, 선택한 용어는 오른쪽 상세 패널에서 확인합니다. 키보드: 방향키로 이동, Home 전체 맞춤, Escape로 선택 해제합니다."} />
        </div>

        {topBar && <div className="graph-toolbar-top-bar flex min-w-0 shrink-0 items-center gap-1.5">{topBar}</div>}

        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className="graph-toolbar-control btn-ghost h-8 px-2 text-xs" aria-label="배치 초기화" title="배치 초기화" onClick={resetLayout}>
            <span className="graph-toolbar-control-icon" aria-hidden><IconReset /></span>
            <span className="graph-toolbar-control-label-full">배치 초기화</span>
            <span className="graph-toolbar-control-label-compact">초기화</span>
          </button>
          <button type="button" className="graph-toolbar-control btn-ghost h-8 px-2 text-xs" aria-label="전체 맞춤" title="전체 맞춤" onClick={fitView}>
            <span className="graph-toolbar-control-icon" aria-hidden><IconFit /></span>
            <span className="graph-toolbar-control-label-full">전체 맞춤</span>
            <span className="graph-toolbar-control-label-compact">맞춤</span>
          </button>
          <button type="button" className="btn-ghost grid h-8 w-8 place-items-center p-0" aria-label="축소" onClick={() => updateZoom(view.scale / 1.2)}>
            <IconMinus />
          </button>
          <button type="button" className="graph-toolbar-control-zoom btn-quiet h-8 min-w-12 px-2 text-[11px] tabular-nums" aria-label={`배율 ${zoomLabel}, 기본 배율로 돌아가기`} title="배율 초기화" onClick={resetView}>
            {zoomLabel}
          </button>
          <button type="button" className="btn-ghost grid h-8 w-8 place-items-center p-0" aria-label="확대" onClick={() => updateZoom(view.scale * 1.2)}>
            <IconPlus />
          </button>
        </div>
      </div>

      <div className="relative min-h-[400px] min-w-0 flex-1 sm:min-h-[460px]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        tabIndex={0}
        onKeyDown={handleGraphKey}
        aria-labelledby="term-graph-title term-graph-description"
        className="block h-full min-h-[400px] w-full cursor-grab touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:cursor-grabbing sm:min-h-[460px]"
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={() => setView({ x: 0, y: 0, scale: 1 })}
      >
        <title id="term-graph-title">{mode === "semantic" ? "승인된 의미 관계도" : "도메인, 업무 분류와 주제로 연결한 용어 관계도"}</title>
        <desc id="term-graph-description">방향키로 이동, Home으로 전체 맞춤, Escape로 선택 해제. Tab으로 노드를 탐색하고 Enter 또는 Space로 선택하면 오른쪽 상세 패널이 열립니다.</desc>
        <rect width={WIDTH} height={HEIGHT} className="fill-transparent" />
        {mode === "semantic" && <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink-3" /></marker></defs>}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="stroke-line-strong" strokeWidth={1.15 / canvasScale}>
            {model.edges.map((edge) => {
              const source = byKey.get(edge.source);
              const target = byKey.get(edge.target);
              if (!source || !target) return null;
              const emphasized = !active || edge.source === active || edge.target === active;
              if (edge.relation) {
                const dx = target.x - source.x, dy = target.y - source.y;
                const length = Math.max(1, Math.hypot(dx, dy));
                const bend = (edgeLanes.get(edge.key) ?? 0) * 36 * visualNodeScale * (edge.source < edge.target ? 1 : -1);
                const controlX = (source.x + target.x) / 2 - dy / length * bend;
                const controlY = (source.y + target.y) / 2 + dx / length * bend;
                const tangentX = target.x - controlX, tangentY = target.y - controlY;
                const insetRatio = Math.min(0.8, 1 / Math.max(0.01, Math.abs(tangentX) / ((termNodeWidth(target.label) / 2 + 6) * visualNodeScale), Math.abs(tangentY) / (20 * visualNodeScale)));
                const endX = target.x - tangentX * insetRatio;
                const endY = target.y - tangentY * insetRatio;
                return <g key={edge.key} opacity={emphasized ? 0.85 : 0.1}>
                  <path d={`M ${stableCoordinate(source.x)} ${stableCoordinate(source.y)} Q ${stableCoordinate(controlX)} ${stableCoordinate(controlY)} ${stableCoordinate(endX)} ${stableCoordinate(endY)}`} fill="none" markerEnd={`url(#${markerId})`} />
                  {active && emphasized && <text x={stableCoordinate((source.x + 2 * controlX + endX) / 4)} y={stableCoordinate((source.y + 2 * controlY + endY) / 4 - 6 * visualNodeScale)} textAnchor="middle" stroke="none" className="fill-ink-2" fontSize={10 * visualNodeScale}>{RELATION_LABEL[edge.relation.relationType]}</text>}
                </g>;
              }
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
            const related = !active || node.key === active || node.key === focused || activeNeighbors?.has(node.key);
            const selectedHere = selected === node.key;
            const category = node.kind === "category" ? node.key.slice(2) : null;
            const domain = node.kind === "domain" ? node.key.slice(2) : null;
            const domainHue = domain ? domainHues.get(domain) : undefined;
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
                onFocus={() => focusNode(node)}
                onBlur={() => setFocused(null)}
                onClick={() => {
                  if (suppressClickRef.current === node.key) {
                    suppressClickRef.current = null;
                    return;
                  }
                  setSelected(node.key);
                }}
                onKeyDown={(event) => selectWithKeyboard(event, node.key)}
              >
                <g transform={`scale(${visualNodeScale})`}>
                  <circle
                    r={node.radius}
                    className={`${
                      node.kind === "category"
                        ? "graph-category-node"
                        : node.kind === "topic"
                          ? "graph-topic-node"
                          : "graph-domain-node"
                    } group-focus-visible/hub:stroke-[4px]`}
                    strokeWidth={selectedHere ? 3.5 : 2}
                  />
                  <text
                    textAnchor="middle"
                    dy="4"
                    className={`pointer-events-none text-[12px] font-semibold ${
                      node.kind === "category"
                        ? "graph-category-label"
                        : node.kind === "topic" ? "graph-topic-label" : "graph-domain-label"
                    }`}
                  >
                    {node.label.slice(0, 12)}
                  </text>
                </g>
              </g>
            );
          })}

          {nodes.filter((node) => node.kind === "term").map((node) => {
            const term = node.term!;
            const related = !active || node.key === active || node.key === focused || activeNeighbors?.has(node.key);
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
                aria-label={mode === "semantic" ? `용어 ${node.label}, 표시된 의미 관계 ${model.edges.filter((edge) => edge.source === node.key || edge.target === node.key).length}개` : `용어 ${node.label}, 전체 연결 ${termRelations(term).length}개, 그래프에 ${neighbors.get(node.key)?.size ?? 0}개 표시${term.ownerName ? `, 담당 ${term.ownerName}` : ""}`}
                aria-pressed={selectedHere}
                className="group/term outline-none"
                onPointerDown={(event) => startNodeDrag(event, node.key)}
                onFocus={() => focusNode(node)}
                onBlur={() => setFocused(null)}
                onClick={() => {
                  if (suppressClickRef.current === node.key) {
                    suppressClickRef.current = null;
                    return;
                  }
                  setSelected(node.key);
                }}
                onKeyDown={(event) => selectWithKeyboard(event, node.key)}
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

      {activeNode && (
        <aside
          ref={detailsRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="term-graph-inspector-title"
          className="absolute right-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel/95 p-3 text-xs shadow-pop backdrop-blur sm:right-4 sm:top-4"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setSelected(null);
            svgRef.current?.focus();
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-brand">{kindLabel(activeNode.kind)}</p>
              <h2 id="term-graph-inspector-title" className="mt-0.5 break-words text-sm font-semibold text-ink">{activeNode.label}</h2>
              <p className="mt-1 text-ink-3">{mode === "semantic" ? "표시된 의미 관계" : "전체 연결"} {activeConnectionCount}개{mode !== "semantic" && activeNode.term && activeConnectionCount !== (activeNeighbors?.size ?? 0) ? ` · 그래프에 ${activeNeighbors?.size ?? 0}개 표시` : ""}</p>
            </div>
            <button
              type="button"
              className="btn-quiet grid h-7 w-7 shrink-0 place-items-center p-0 text-lg leading-none"
              aria-label="선택한 노드 패널 닫기"
              onClick={() => {
                setSelected(null);
                svgRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>

          {model.omittedHubCount > 0 && (
            <p className="mt-3 rounded-lg bg-panel-2 px-2.5 py-2 text-[11px] leading-5 text-ink-2">
              그래프에서 허브 {model.omittedHubCount}개와 연결 {model.omittedEdgeCount}개를 생략했습니다. 전체 연결은 아래 목록에서 확인할 수 있습니다.
            </p>
          )}

          {activeNode.kind === "term" && activeNode.term ? (
            <Link href={`/g/${activeNode.term.slug}`} className="mt-3 inline-flex rounded-md bg-brand-soft px-2.5 py-1.5 font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45">상세 보기</Link>
          ) : relatedTerms.length > 0 ? (
            <section className="mt-3" aria-labelledby="term-graph-related-title">
              <h3 id="term-graph-related-title" className="font-medium text-ink">연결된 용어</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {relatedTerms.slice(0, 6).map((node) => (
                  <Link key={node.key} href={`/g/${node.term!.slug}`} className="max-w-36 truncate rounded-md border border-line px-2 py-1 text-ink-2 hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45">
                    {node.label}
                  </Link>
                ))}
                {relatedTerms.length > 6 && <span className="self-center text-ink-3">외 {relatedTerms.length - 6}개</span>}
              </div>
            </section>
          ) : null}

          {mode === "semantic" && (
            <section className="mt-3" aria-labelledby="term-graph-evidence-title">
              <h3 id="term-graph-evidence-title" className="font-medium text-ink">표시된 의미 관계</h3>
              <ul className="mt-1.5 max-h-44 space-y-2 overflow-y-auto" aria-label="표시된 의미 관계의 근거">
                {selectedEdges.map((edge) => <li key={edge.key} className="rounded border border-line p-2">
                  <p className="break-words font-medium">{byKey.get(edge.source)?.label} → {RELATION_LABEL[edge.relation!.relationType]} → {byKey.get(edge.target)?.label}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{edge.relation!.evidenceMd || "기록된 근거가 없습니다."}</p>
                </li>)}
                {selectedEdges.length === 0 && <li className="rounded border border-line p-2 text-ink-3">표시된 승인 관계가 없습니다.</li>}
                <li className="text-ink-3">제안·거절된 관계와 화면 밖 용어의 연결은 아래 관리 목록에서 확인하세요.</li>
              </ul>
            </section>
          )}

          {mode !== "semantic" && activeNode.term && activeRelations.length > 0 && (
            <section className="mt-3" aria-labelledby="term-graph-connections-title">
              <h3 id="term-graph-connections-title" className="font-medium text-ink">전체 연결</h3>
              <ul className="mt-1.5 flex max-h-32 flex-wrap gap-2 overflow-y-auto" aria-label="전체 연결 목록">
                {activeRelations.map((relation) => (
                  <li key={relation.key} className="max-w-full break-words rounded-md border border-line px-2 py-1 text-ink-2">
                    {kindLabel(relation.kind)} · {relation.label}{!byKey.has(relation.key) ? " (그래프에서 생략)" : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-panel/80 px-2.5 py-1.5 text-[11px] text-ink-3 backdrop-blur-sm">
        {mode !== "semantic" && <>
          <TermColorLegend hues={[...new Set(domainHues.values())].slice(0, 3)} label="도메인" variant="domain" />
          <TermColorLegend hues={categoryHues} label="업무 분류" variant="category" />
          <LegendDot className="graph-topic-swatch border" label="주제" />
        </>}
        <TermColorLegend hues={[...new Set(termColorHues.values())].slice(0, 3)} label="용어 · 분류색 우선" variant="term" />
      </div>
      {model.omittedHubCount > 0 && (
        <p className="sr-only" aria-live="polite">
          그래프에서 허브 {model.omittedHubCount}개와 연결 {model.omittedEdgeCount}개를 생략했습니다.
        </p>
      )}
      </div>
      <p className="sr-only" aria-live="polite">
        {activeNode ? `${kindLabel(activeNode.kind)} ${activeNode.label}, ${mode === "semantic" ? "표시된 의미 관계" : "전체 연결"} ${activeConnectionCount}개` : "전체 관계도"}
      </p>
    </section>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center"><i aria-hidden="true" className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${className}`} />{label}</span>;
}

function TermColorLegend({
  hues,
  label,
  variant,
}: {
  hues: number[];
  label: string;
  variant: "domain" | "category" | "term";
}) {
  return (
    <span className="inline-flex items-center">
      <span className="mr-1.5 inline-flex -space-x-1" aria-hidden="true">
        {hues.map((hue) => {
          return (
            <i
              key={hue}
              className={`${variant === "domain" ? "graph-domain-swatch rounded-full" : "graph-category-swatch"} h-2.5 w-2.5 border border-panel ${variant === "term" ? "rounded-[3px]" : "rounded-full"}`}
              style={graphColorStyle(hue)}
            />
          );
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

function IconReset() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5"><path d="M4 7.25A6.25 6.25 0 1 1 3.75 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M4 3.75v3.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function IconFit() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5"><path d="M7 3H5.25A2.25 2.25 0 0 0 3 5.25V7M13 3h1.75A2.25 2.25 0 0 1 17 5.25V7M7 17H5.25A2.25 2.25 0 0 1 3 14.75V13M13 17h1.75A2.25 2.25 0 0 0 17 14.75V13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
