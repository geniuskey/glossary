import type { GraphTerm } from "@/lib/terms/query";
import { displayName, spineHue } from "@/lib/ui/format";

interface Hub { key: string; label: string; kind: "domain" | "category"; x: number; y: number }
interface Node { term: GraphTerm; x: number; y: number; hubs: string[] }

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function TermGraph({ terms }: { terms: GraphTerm[] }) {
  const hubDefs = new Map<string, { label: string; kind: "domain" | "category" }>();
  for (const term of terms) {
    for (const domain of term.domain) hubDefs.set(`d:${domain}`, { label: domain, kind: "domain" });
    if (term.category) hubDefs.set(`c:${term.category}`, { label: term.category, kind: "category" });
  }

  const defs = [...hubDefs.entries()].slice(0, 18);
  const hubs: Hub[] = defs.map(([key, def], index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, defs.length) - Math.PI / 2;
    const radius = defs.length <= 5 ? 210 : 270;
    return { key, ...def, x: 500 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius };
  });
  const hubByKey = new Map(hubs.map((hub) => [hub.key, hub]));

  const nodes: Node[] = terms.slice(0, 100).map((term, index) => {
    const keys = [
      ...(term.category ? [`c:${term.category}`] : []),
      ...term.domain.map((domain) => `d:${domain}`),
    ].filter((key) => hubByKey.has(key));
    const anchor = hubByKey.get(keys[0] ?? "");
    const seed = hash(term.slug);
    const angle = ((seed % 360) * Math.PI) / 180;
    const distance = 58 + ((seed >>> 8) % 58) + (index % 3) * 8;
    return {
      term,
      hubs: keys,
      x: anchor ? anchor.x + Math.cos(angle) * distance : 500 + Math.cos(angle) * (80 + (index % 5) * 22),
      y: anchor ? anchor.y + Math.sin(angle) * distance : 350 + Math.sin(angle) * (80 + (index % 5) * 22),
    };
  });

  if (terms.length === 0) {
    return <div className="card px-5 py-16 text-center text-sm text-ink-3">조건에 맞는 용어가 없습니다.</div>;
  }

  return (
    <div className="card overflow-hidden bg-panel-2/40">
      <svg viewBox="0 0 1000 700" role="img" aria-label="도메인과 카테고리로 연결한 용어 관계도" className="h-auto min-h-[520px] w-full">
        <g className="stroke-line-strong" strokeWidth="1">
          {nodes.flatMap((node) => node.hubs.map((key) => {
            const hub = hubByKey.get(key)!;
            return <line key={`${node.term.id}:${key}`} x1={node.x} y1={node.y} x2={hub.x} y2={hub.y} opacity="0.42" />;
          }))}
        </g>
        {hubs.map((hub) => (
          <g key={hub.key} transform={`translate(${hub.x} ${hub.y})`}>
            <circle r={hub.kind === "category" ? 28 : 34} className={hub.kind === "category" ? "fill-brand-soft stroke-brand" : "fill-panel stroke-line-strong"} strokeWidth="2" />
            <text textAnchor="middle" dy="4" className="fill-ink text-[12px] font-semibold">{hub.label.slice(0, 12)}</text>
            <title>{hub.kind === "category" ? "카테고리" : "도메인"}: {hub.label}</title>
          </g>
        ))}
        {nodes.map(({ term, x, y }) => (
          <a key={term.id} href={`/w/${term.slug}`}>
            <g transform={`translate(${x} ${y})`} className="cursor-pointer">
              <circle r="12" fill={`hsl(${spineHue(term.slug)} 62% 55%)`} className="stroke-panel" strokeWidth="3" />
              <text x="16" y="4" className="fill-ink text-[11px] font-medium">{displayName(term).slice(0, 18)}</text>
              <title>{displayName(term)}{term.ownerName ? ` · 담당 ${term.ownerName}` : ""}</title>
            </g>
          </a>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 border-t border-line px-4 py-3 text-xs text-ink-3">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-line-strong bg-panel" />도메인</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-brand bg-brand-soft" />카테고리</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-accent" />용어 · 누르면 상세로 이동</span>
      </div>
    </div>
  );
}
