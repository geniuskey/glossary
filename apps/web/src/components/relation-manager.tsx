"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RELATION_HELP, RELATION_LABEL, RELATION_STATUS_LABEL, RELATION_TYPES,
  type ManagedRelation, type RelationPage, type RelationStatus, type RelationTerm, type RelationType } from "@/lib/terms/relation-values";

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "처리하지 못했습니다. 다시 시도해 주세요.");
  return body;
}

function TermPicker({ label, value, onChange, disabled }: { label: string; value: RelationTerm | null; onChange: (term: RelationTerm | null) => void; disabled: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RelationTerm[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setItems([]);
    if (!query.trim() || value) { setMessage(""); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    const timer = window.setTimeout(() => {
      jsonRequest(`/api/v1/relations/terms?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((body) => { if (!controller.signal.aborted) { setItems(body.items); setTotal(body.total); setMessage(body.items.length ? "" : "검색 결과가 없습니다."); } })
        .catch((error) => { if (!controller.signal.aborted) setMessage(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, value]);
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">{label}</label>
      {value ? (
        <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/g/${value.slug}`} className="break-words font-medium text-brand hover:underline">{value.name}</Link>
            <button type="button" disabled={disabled} className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => { onChange(null); setQuery(""); }}>변경</button>
          </div>
          <p className="mt-1 break-words text-xs text-ink-3">{value.domain.join(" · ") || "도메인 없음"}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-2">{value.definition || "정의가 아직 없습니다. 용어 상세 내용을 확인해 주세요."}</p>
        </div>
      ) : (
        <>
          <input id={id} name={id} className="field w-full" placeholder="용어 검색, 예: 이미지 센서…" value={query} maxLength={200} autoComplete="off" disabled={disabled} onChange={(event) => setQuery(event.target.value)} />
          <p className="mt-1 text-xs text-ink-3" role="status">{loading ? "검색 중…" : message}</p>
          {items.length > 0 && !loading && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-panel" aria-label={`${label} 검색 결과`}>
              {items.map((item) => <li key={item.id}><button type="button" disabled={disabled} className="w-full px-3 py-2 text-left text-sm hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand" onClick={() => onChange(item)}>
                <span className="block break-words font-medium">{item.name}</span><span className="text-xs text-ink-3">{item.domain.join(" · ") || "도메인 없음"}</span>
              </button></li>)}
              {total > items.length && <li className="p-2 text-xs text-ink-3">{total}개 중 {items.length}개 표시 · 검색어를 좁혀 주세요.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function RelationFields({ type, evidence, setType, setEvidence, disabled }: { type: RelationType; evidence: string; setType: (type: RelationType) => void; setEvidence: (value: string) => void; disabled: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={`${id}-type`} className="block text-xs font-medium text-ink-2">관계 종류 (A → B)</label>
    <select id={`${id}-type`} className="field w-full" value={type} onChange={(event) => setType(event.target.value as RelationType)} disabled={disabled} aria-describedby={`${id}-help`}>
      {RELATION_TYPES.map((value) => <option key={value} value={value}>{RELATION_LABEL[value]} · {value}</option>)}
    </select>
    <p id={`${id}-help`} className="text-xs text-ink-3">{RELATION_HELP[type]}</p>
    <label htmlFor={`${id}-evidence`} className="block text-xs font-medium text-ink-2">관계의 근거</label>
    <textarea id={`${id}-evidence`} className="field min-h-24 w-full" required maxLength={4000} value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={disabled} placeholder="두 용어가 연결되는 이유와 확인 가능한 문서·절을 적어 주세요…" />
  </>;
}

function RelationEditor({ relation, busy, onSave, onCancel }: { relation: ManagedRelation; busy: boolean; onSave: (type: RelationType, evidence: string) => void; onCancel: () => void }) {
  const [type, setType] = useState(relation.relationType);
  const [evidence, setEvidence] = useState(relation.evidenceMd ?? "");
  return <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); if (evidence.trim()) onSave(type, evidence.trim()); }}>
    <p className="text-xs text-ink-2">아래 최신 정의를 확인해 근거를 수정하세요. 저장하면 검토 대기로 돌아가며 다시 승인하기 전까지 그래프와 챗봇에서 제외됩니다.</p>
    <div className="grid gap-2 sm:grid-cols-2">{[relation.source, relation.target].map((term, index) => <div key={term.id} className="rounded border border-line p-2 text-xs">
      <strong>{index === 0 ? "A" : "B"} · {term.name}</strong><p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{term.definition || "정의 없음 — 상세 내용을 확인해 주세요."}</p>
    </div>)}</div>
    <RelationFields type={type} evidence={evidence} setType={setType} setEvidence={setEvidence} disabled={busy} />
    <div className="flex gap-2"><button className="btn-primary text-xs" disabled={busy || !evidence.trim()}>{busy ? "저장 중…" : "수정 후 재검토"}</button><button className="btn-ghost text-xs" type="button" disabled={busy} onClick={onCancel}>취소</button></div>
  </form>;
}

export function RelationManager({ selectedTerm, onClearSelection, initialCreateOpen = false }: { selectedTerm: { id: string; name: string } | null; onClearSelection: () => void; initialCreateOpen?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [source, setSource] = useState<RelationTerm | null>(null);
  const [target, setTarget] = useState<RelationTerm | null>(null);
  const [type, setType] = useState<RelationType>("related_to");
  const [evidence, setEvidence] = useState("");
  const [status, setStatus] = useState<RelationStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<RelationType | "">("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<RelationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [lookupTerm, setLookupTerm] = useState<RelationTerm | null>(null);
  const termId = selectedTerm?.id ?? lookupTerm?.id;
  useEffect(() => { setPage(1); setEditing(null); }, [termId, status, typeFilter]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (termId) params.set("termId", termId);
    if (status) params.set("status", status);
    if (typeFilter) params.set("type", typeFilter);
    setLoading(true); setLoadError("");
    jsonRequest(`/api/v1/relations?${params}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) setResult(body); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [termId, status, typeFilter, page, reload]);

  async function mutate(url: string, method: string, body: unknown, success: string): Promise<boolean> {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMessage(success); setEditing(null); setReload((value) => value + 1); router.refresh();
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : "접속하지 못했습니다. 다시 시도해 주세요."); return false; }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!source || !target) { setError("A와 B 용어를 검색해 선택해 주세요."); return; }
    if (source.id === target.id) { setError("서로 다른 용어를 선택해 주세요."); return; }
    if (await mutate("/api/v1/relations", "POST", { sourceTermId: source.id, targetTermId: target.id, sourceRevision: source.revision, targetRevision: target.revision, relationType: type, evidenceMd: evidence.trim() }, "관계를 제안했습니다. 근거를 검토한 뒤 승인해 주세요.")) {
      setSource(null); setTarget(null); setEvidence(""); setStatus("proposed"); setTypeFilter(""); setPage(1); setLookupTerm(null); onClearSelection();
    }
  }

  return <section id="semantic-relation-manager" className="card mt-6 scroll-mt-6 p-4 sm:p-5" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-base font-semibold">의미 관계 관리</h2>
    <p className="mt-1 text-xs text-ink-3">제안 → 근거 검토 → 승인. 승인 후 용어가 바뀌지 않은 관계만 그래프와 챗봇이 사용합니다.</p>
    <details open={initialCreateOpen || undefined} className="mt-4 rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm font-medium">새 관계 제안</summary>
      <form onSubmit={create} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><TermPicker label="A · 출발 용어" value={source} onChange={setSource} disabled={busy} /><TermPicker label="B · 도착 용어" value={target} onChange={setTarget} disabled={busy} /></div>
        <RelationFields type={type} evidence={evidence} setType={setType} setEvidence={setEvidence} disabled={busy} />
        {source && target && <p className="break-words text-sm text-ink-2">{source.name} → {RELATION_LABEL[type]} → {target.name}</p>}
        <button className="btn-primary text-sm" disabled={busy || !source || !target || !evidence.trim()}>{busy ? "저장 중…" : "관계 제안 저장"}</button>
      </form>
    </details>
    <p className="mt-2 text-sm text-brand" role="status">{message}</p>
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        {selectedTerm ? <p className="text-sm">선택한 용어: <strong>{selectedTerm.name}</strong> <button type="button" className="btn-ghost text-xs" onClick={() => { onClearSelection(); setLookupTerm(null); }}>전체 관계 보기</button></p>
          : <TermPicker label="관계를 찾을 용어 (선택 사항)" value={lookupTerm} onChange={setLookupTerm} disabled={busy} />}
      </div>
      <label className="text-xs text-ink-2">승인 상태<select className="field mt-1 block" value={status} onChange={(event) => setStatus(event.target.value as RelationStatus | "")}><option value="">전체 상태</option>{Object.entries(RELATION_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs text-ink-2">관계 종류<select className="field mt-1 block" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as RelationType | "")}><option value="">전체 종류</option>{RELATION_TYPES.map((value) => <option key={value} value={value}>{RELATION_LABEL[value]}</option>)}</select></label>
      <button type="button" className="btn-ghost text-xs" disabled={loading || busy} onClick={() => { setEditing(null); setReload((value) => value + 1); }}>목록 새로고침</button>
    </div>
    <p className="mt-2 text-xs text-ink-3">관리 목록은 상단 그래프의 분류 필터와 별개입니다. 그래프에서 노드를 선택하면 해당 용어의 모든 관계를 조회합니다.</p>
    {loadError && <p className="mt-3 text-sm text-danger" role="alert">{loadError}</p>}
    <div className="mt-3 space-y-3" aria-busy={loading}>
      {loading ? <p role="status" className="text-sm text-ink-3">관계를 불러오는 중…</p> : !loadError && <>
        <p className="text-xs text-ink-3">{new Intl.NumberFormat("ko-KR").format(result?.total ?? 0)}개 관계</p>
        {!result?.items.length && <p className="py-4 text-sm text-ink-3">조건에 맞는 관계가 없습니다. 필터를 변경하거나 새 관계를 제안해 주세요.</p>}
        {result?.items.map((relation) => <article key={relation.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link className="break-words font-medium text-brand hover:underline" href={`/g/${relation.source.slug}`}>{relation.source.name}</Link>
            <span className="rounded bg-panel-2 px-2 py-1 text-xs">→ {RELATION_LABEL[relation.relationType]} →</span>
                  <Link className="break-words font-medium text-brand hover:underline" href={`/g/${relation.target.slug}`}>{relation.target.name}</Link>
            <span className="ml-auto text-xs text-ink-3">{RELATION_STATUS_LABEL[relation.status]}{relation.stale ? " · 재검토 필요" : ""}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-2">{relation.evidenceMd || "근거 없음 — 승인 전에 근거를 작성해 주세요."}</p>
          {relation.stale && <p className="mt-2 text-xs text-ink-2">용어가 변경되어 그래프와 챗봇에서 제외됩니다. 최신 정의를 확인하고 ‘근거·종류 수정’으로 재검토해 주세요.</p>}
          <p className="mt-2 text-xs text-ink-3">{relation.reviewedAt ? `마지막 검토·수정: ${relation.reviewerName ?? "이름이 남아 있지 않은 검토자"} · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(relation.reviewedAt))}` : "아직 검토되지 않았습니다."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {relation.status === "proposed" && <button type="button" className="btn-primary text-xs" disabled={busy || relation.stale || !relation.evidenceMd?.trim()} onClick={() => mutate(`/api/v1/relations/${relation.id}`, "PATCH", { action: "approved", version: relation.version }, "관계를 승인했습니다. 그래프와 챗봇의 다음 검색에 반영됩니다.")}>관계 승인</button>}
            {relation.status !== "rejected" && <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => mutate(`/api/v1/relations/${relation.id}`, "PATCH", { action: "rejected", version: relation.version }, "관계를 거절했습니다. 필요하면 수정 후 다시 검토할 수 있습니다.")}>{relation.status === "approved" ? "승인 철회" : "관계 거절"}</button>}
            <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => setEditing(relation.id)}>근거·종류 수정</button>
          </div>
          {editing === relation.id && <RelationEditor key={relation.version} relation={relation} busy={busy} onCancel={() => setEditing(null)} onSave={(relationType, evidenceMd) => mutate(`/api/v1/relations/${relation.id}`, "PATCH", { action: "edit", version: relation.version, relationType, evidenceMd, sourceRevision: relation.source.revision, targetRevision: relation.target.revision }, "수정한 관계를 검토 대기로 저장했습니다. 다시 승인해 주세요.")} />}
        </article>)}
        {result && result.total > 20 && <nav className="flex items-center justify-end gap-3 text-sm" aria-label="관계 목록 페이지"><button type="button" className="btn-ghost" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>이전</button><span>{page} / {Math.ceil(result.total / 20)}</span><button type="button" className="btn-ghost" disabled={page * 20 >= result.total || busy} onClick={() => setPage(page + 1)}>다음</button></nav>}
      </>}
    </div>
  </section>;
}
