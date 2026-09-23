"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TermGraph } from "./term-graph";
import { RelationManager } from "./relation-manager";
import type { GraphTerm } from "@/lib/terms/query";
import type { RelationTerm, SemanticRelation } from "@/lib/terms/relation-values";
import { RELATION_LABEL } from "@/lib/terms/relation-values";
import { displayName } from "@/lib/ui/format";

type SemanticPathView = {
  id: string;
  sourceTermId: string;
  targetTermId: string;
  predicateLabel: string;
  depth: number;
  evidenceMd: string | null;
};
type Overview = { totalTerms: number; usable: number; proposed: number; stale: number; omitted: number };

export function SemanticGraphWorkspace({ panel, terms, relations, overview, focusTerm, invalidFocus, paths, domainColors }: {
  panel: "explore" | "manage";
  terms: GraphTerm[];
  relations: SemanticRelation[];
  overview: Overview;
  focusTerm: GraphTerm | null;
  invalidFocus: boolean;
  paths: SemanticPathView[];
  domainColors: { label: string; color: string }[];
}) {
  const router = useRouter();
  const [selectedTerm, setSelectedTerm] = useState<{ id: string; name: string } | null>(null);
  const byId = useMemo(() => new Map(terms.map((term) => [term.id, term])), [terms]);
  const number = useMemo(() => new Intl.NumberFormat("ko-KR"), []);
  const manageFocus = selectedTerm ? byId.get(selectedTerm.id) : focusTerm;
  const manageHref = `/graph?view=semantic&panel=manage${manageFocus ? `&focus=${encodeURIComponent(manageFocus.slug)}` : ""}`;
  const visiblePaths = focusTerm ? paths : relations.map((relation) => ({
    id: relation.id, sourceTermId: relation.sourceTermId, targetTermId: relation.targetTermId,
    predicateLabel: RELATION_LABEL[relation.relationType], depth: 1, evidenceMd: relation.evidenceMd,
  }));

  return <div className="min-h-full bg-paper">
    <div className="mx-auto max-w-[96rem] px-5 py-6 lg:px-8">
      {panel === "explore" ? <>
      <header className="max-w-4xl">
        <h2 className="text-xl font-semibold tracking-tight text-ink">용어가 어떻게 연결되는지 확인하세요</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">사용 가능한 승인 관계에서 용어를 골라 최대 2단계 연결과 근거를 살펴볼 수 있습니다.</p>
      </header>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-panel p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">용어 중심으로 살펴보기</h3>
          <p className="mt-1 text-xs leading-5 text-ink-3">한 용어에서 출발해 직접 연결과 그 다음 연결을 따라갑니다. 관계의 방향과 근거를 함께 확인하세요.</p>
        </div>
        <SemanticFocusSearch focusTerm={focusTerm} />
      </div>

      {invalidFocus && <p className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">해당 용어를 찾지 못했습니다. 다른 용어를 검색해 주세요.</p>}

      {relations.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-line-strong bg-panel p-8" aria-labelledby="semantic-empty-title">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold text-brand">{focusTerm ? "이 용어의 연결" : "의미 관계 준비 상태"}</p>
            <h3 id="semantic-empty-title" className="mt-2 text-lg font-semibold text-ink">{focusTerm ? `${displayName(focusTerm)}에 사용 가능한 승인 관계가 없습니다` : "아직 사용 가능한 승인 관계가 없습니다"}</h3>
            <p className="mt-2 text-sm leading-6 text-ink-2">도메인·업무 분류가 같다는 사실만으로 의미 관계를 만들지는 않습니다. 두 용어가 어떤 관계인지와 확인 가능한 근거를 기록하고 승인해야 이 화면과 챗봇의 관계 확장에 반영됩니다.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={manageHref} className="btn-primary">관계 제안·검토하기</Link>
              <Link href="/graph?view=classification" className="btn-ghost">분류 연결 살펴보기</Link>
            </div>
            {overview.proposed > 0 && <p className="mt-4 text-xs text-ink-3">검토 대기 {number.format(overview.proposed)}개가 있습니다. 관계 관리에서 근거와 방향을 확인하세요.</p>}
          </div>
        </section>
      ) : (
        <div className="mt-5 grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(21rem,0.7fr)]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel" aria-labelledby="semantic-map-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div><h3 id="semantic-map-title" className="text-sm font-semibold text-ink">{focusTerm ? `${displayName(focusTerm)}의 2단계 관계` : "승인 관계 지도"}</h3><p className="mt-0.5 text-xs text-ink-3">{number.format(terms.length)}개 용어 · {number.format(relations.length)}개 관계{!focusTerm && overview.omitted > 0 ? ` · ${number.format(overview.omitted)}개 관계는 표시 범위 밖` : ""}</p></div>
              <div className="flex gap-2">
                {selectedTerm && <Link href={manageHref} className="btn-ghost btn-sm">선택한 용어 관리</Link>}
                {focusTerm && <Link href="/graph?view=semantic" className="btn-ghost btn-sm">전체 관계로 돌아가기</Link>}
              </div>
            </div>
            <div className="h-[min(66vh,660px)] min-h-[460px]"><TermGraph terms={terms} domainColors={domainColors} mode="semantic" semanticRelations={relations} onSelectTerm={setSelectedTerm} /></div>
          </section>
          <section className="min-w-0 rounded-xl border border-line bg-panel p-4" aria-labelledby="semantic-path-title">
            <h3 id="semantic-path-title" className="text-sm font-semibold text-ink">{focusTerm ? "연결 경로와 근거" : "표시된 관계와 근거"}</h3>
            <p className="mt-1 text-xs leading-5 text-ink-3">{focusTerm ? "1단계는 직접 연결, 2단계는 이웃 용어를 통한 연결입니다. 목록은 탐색 방향으로 읽고 그래프의 화살표는 저장된 관계 방향을 나타냅니다." : "화살표 방향, 관계 종류, 기록된 근거를 함께 확인하세요."}</p>
            <ol className="mt-4 max-h-[min(59vh,580px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {visiblePaths.map((path) => <li key={path.id} className="rounded-lg border border-line bg-panel-2/35 p-3">
                {focusTerm && <span className="text-[11px] font-semibold text-brand">{path.depth}단계</span>}
                <p className="mt-1 break-words text-xs font-medium leading-5 text-ink">{byId.get(path.sourceTermId) ? displayName(byId.get(path.sourceTermId)!) : "용어"} <span className="text-brand">→ {path.predicateLabel} →</span> {byId.get(path.targetTermId) ? displayName(byId.get(path.targetTermId)!) : "용어"}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-2">{path.evidenceMd || "기록된 근거가 없습니다."}</p>
              </li>)}
            </ol>
            {focusTerm && paths.length >= 80 && <p className="mt-3 text-xs text-ink-3">화면과 검색 비용을 제한하기 위해 최대 80개 경로를 표시합니다.</p>}
          </section>
        </div>
      )}

      </> : <>
        <header className="max-w-4xl">
          <h2 className="text-xl font-semibold tracking-tight text-ink">관계를 제안하고 검토하세요</h2>
          <p className="mt-2 text-sm leading-6 text-ink-2">근거와 방향을 확인해 승인하면 관계 탐색과 챗봇 검색에 반영됩니다. 용어가 바뀐 관계는 다시 검토해야 합니다.</p>
        </header>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="의미 관계 현황">
          <Metric value={number.format(overview.usable)} label="사용 가능한 승인 관계" detail="그래프와 챗봇 검색에 반영" />
          <Metric value={number.format(overview.proposed)} label="검토 대기" detail="근거 확인 후 승인 필요" />
          <Metric value={number.format(overview.stale)} label="재검토 필요" detail="용어 수정으로 검색에서 제외" />
          <Metric value={number.format(overview.totalTerms)} label="등록 용어" detail="분류 연결은 별도 보기" />
        </div>
        {invalidFocus && <p className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">해당 용어를 찾지 못했습니다. 아래에서 다른 용어를 검색해 주세요.</p>}
        <RelationManager selectedTerm={focusTerm ? { id: focusTerm.id, name: displayName(focusTerm) } : null} onClearSelection={() => router.push("/graph?view=semantic&panel=manage")} initialCreateOpen={overview.usable === 0 && overview.proposed === 0} />
      </>}
    </div>
  </div>;
}

function Metric({ value, label, detail }: { value: string; label: string; detail: string }) {
  return <div className="rounded-xl border border-line bg-panel px-4 py-3"><p className="font-mono text-2xl font-semibold tabular-nums text-ink">{value}</p><p className="mt-1 text-xs font-semibold text-ink-2">{label}</p><p className="mt-1 text-[11px] text-ink-3">{detail}</p></div>;
}

function SemanticFocusSearch({ focusTerm }: { focusTerm: GraphTerm | null }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RelationTerm[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setItems([]); setMessage(""); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/v1/relations/terms?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error?.message ?? "용어를 찾지 못했습니다.");
          if (!controller.signal.aborted) { setItems(body.items); setMessage(body.items.length ? "" : "일치하는 용어가 없습니다."); }
        })
        .catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "검색하지 못했습니다."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div className="relative w-full max-w-sm">
    <label htmlFor="semantic-focus-search" className="mb-1 block text-xs font-medium text-ink-2">출발 용어</label>
    <input id="semantic-focus-search" className="field w-full" name="semanticFocus" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" maxLength={200} placeholder={focusTerm ? displayName(focusTerm) : "용어 검색…"} />
    <p className="sr-only" role="status" aria-live="polite">{loading ? "용어 검색 중…" : message}</p>
    {items.length > 0 && !loading && <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-pop" aria-label="출발 용어 검색 결과">
      {items.map((item) => <li key={item.id}><Link href={`/graph?view=semantic&focus=${encodeURIComponent(item.slug)}`} className="block rounded-md px-3 py-2 text-sm hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><span className="block font-medium text-ink">{item.name}</span><span className="text-xs text-ink-3">{item.domain.join(" · ") || "도메인 없음"}</span></Link></li>)}
    </ul>}
    {message && !loading && <p className="mt-1 text-xs text-ink-3">{message}</p>}
  </div>;
}
