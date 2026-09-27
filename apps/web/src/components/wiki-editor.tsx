"use client";

import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";
import { normalizeTags } from "@/lib/terms/tags";
import { MAX_WIKI_TAG_LENGTH, MAX_WIKI_TAGS } from "@/lib/wiki/tags";

interface WikiEditorPage {
  id?: string;
  slug?: string;
  title: string;
  summary: string | null;
  sourceUrl?: string | null;
  content?: string;
  domain: string[];
  tags: string[];
  status: "draft" | "published" | "archived";
  terms: Array<{ slug: string; title: string }>;
}

interface DomainOption { key: string; label: string }

interface MatchingTerm {
  slug: string;
  nameEn: string | null;
  nameKo: string | null;
  matchedText: string;
  exact: boolean;
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

const termCollator = new Intl.Collator("ko-KR", { numeric: true });
function sortTerms(terms: WikiEditorPage["terms"]): WikiEditorPage["terms"] {
  return [...terms].sort((a, b) => termCollator.compare(a.title, b.title) || a.slug.localeCompare(b.slug));
}

export function WikiEditor({ initialPage, domains: domainOptions, tagOptions, canPublish }: { initialPage: WikiEditorPage | null; domains: DomainOption[]; tagOptions: string[]; canPublish: boolean }) {
  const router = useRouter();
  const editing = Boolean(initialPage?.id);
  const [slug, setSlug] = useState(initialPage?.slug ?? "");
  const [title, setTitle] = useState(initialPage?.title ?? "");
  const [summary, setSummary] = useState(initialPage?.summary ?? "");
  const [sourceUrl, setSourceUrl] = useState(initialPage?.sourceUrl ?? "");
  const [domainText, setDomainText] = useState(initialPage?.domain.join(", ") ?? "");
  const [tags, setTags] = useState(initialPage?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedTerms, setSelectedTerms] = useState(sortTerms(initialPage?.terms ?? []));
  const [termQuery, setTermQuery] = useState("");
  const [termSearch, setTermSearch] = useState<{ query: string; items: MatchingTerm[] } | null>(null);
  const [termSearchError, setTermSearchError] = useState(false);
  const [termFocused, setTermFocused] = useState(false);
  const [activeTerm, setActiveTerm] = useState(-1);
  const termListId = useId();
  const [content, setContent] = useState(initialPage?.content ?? "");
  const pendingTags = normalizeTags([...tags, ...tagDraft.split(/[,\n]+/)]);
  const tagError = pendingTags.length > MAX_WIKI_TAGS
    ? "태그는 " + MAX_WIKI_TAGS + "개까지 입력할 수 있습니다."
    : pendingTags.some((tag) => tag.length > MAX_WIKI_TAG_LENGTH)
      ? "태그 하나는 " + MAX_WIKI_TAG_LENGTH + "자까지 입력할 수 있습니다."
      : null;
  const [status, setStatus] = useState<WikiEditorPage["status"]>(canPublish ? (initialPage?.status ?? "draft") : "draft");
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termMatches, setTermMatches] = useState<{ title: string; items: MatchingTerm[] } | null>(null);
  const initialStatus: WikiEditorPage["status"] = canPublish ? (initialPage?.status ?? "draft") : "draft";
  const dirty = slug !== (initialPage?.slug ?? "")
    || title !== (initialPage?.title ?? "")
    || summary !== (initialPage?.summary ?? "")
    || sourceUrl !== (initialPage?.sourceUrl ?? "")
    || domainText !== (initialPage?.domain.join(", ") ?? "")
    || JSON.stringify(pendingTags) !== JSON.stringify(initialPage?.tags ?? [])
    || selectedTerms.map((term) => term.slug).join(",") !== sortTerms(initialPage?.terms ?? []).map((term) => term.slug).join(",")
    || content !== (initialPage?.content ?? "")
    || status !== initialStatus;

  useUnsavedChanges(dirty);

  useEffect(() => {
    const query = title.trim();
    if (!query) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/terms/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { items?: MatchingTerm[] };
        setTermMatches({ title: query, items: (data.items ?? []).filter((item) => item.exact) });
      } catch {
        // 제목 안내가 실패해도 위키 작성은 계속할 수 있다.
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [title]);

  useEffect(() => {
    const query = termQuery.trim();
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/terms/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("검색 실패");
        const data = await response.json() as { items?: MatchingTerm[] };
        if (!controller.signal.aborted) {
          setTermSearch({ query, items: data.items ?? [] });
          setTermSearchError(false);
          setActiveTerm(-1);
        }
      } catch {
        if (!controller.signal.aborted) {
          setTermSearch({ query, items: [] });
          setTermSearchError(true);
        }
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [termQuery]);

  const matchingTerms = termMatches?.title === title.trim() ? termMatches.items : [];
  const availableTerms = termSearch?.query === termQuery.trim()
    ? termSearch.items.filter((term) => !selectedTerms.some((selected) => selected.slug === term.slug))
    : [];
  const termSearchReady = termSearch?.query === termQuery.trim();
  const termDropdownOpen = termFocused && Boolean(termQuery.trim());

  function addTags() {
    if (tagError) return;
    setTags(pendingTags);
    setTagDraft("");
  }

  function addTerm(term: MatchingTerm) {
    if (selectedTerms.length >= 20 || selectedTerms.some((selected) => selected.slug === term.slug)) return;
    setSelectedTerms((current) => sortTerms([...current, { slug: term.slug, title: term.nameKo || term.nameEn || term.matchedText || term.slug }]));
    setTermQuery("");
    setTermSearch(null);
    setActiveTerm(-1);
  }

  function onTermKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { setTermFocused(false); event.currentTarget.blur(); return; }
    if (termDropdownOpen && event.key === "Enter") event.preventDefault();
    if (!termDropdownOpen || availableTerms.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveTerm((current) => current === -1
        ? (event.key === "ArrowDown" ? 0 : availableTerms.length - 1)
        : (current + (event.key === "ArrowDown" ? 1 : -1) + availableTerms.length) % availableTerms.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const term = availableTerms[activeTerm >= 0 ? activeTerm : 0];
      if (term) addTerm(term);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || imageUploading || !title.trim() || !content.trim() || tagError || (editing && !dirty)) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        title,
        summary: summary.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        content,
        domain: splitList(domainText),
        tags: pendingTags,
        termSlugs: selectedTerms.map((term) => term.slug),
        status,
      };
      const response = await fetch(editing ? `/api/v1/wiki/${encodeURIComponent(initialPage!.slug!)}` : "/api/v1/wiki", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as { page?: { slug: string }; error?: { message?: string; details?: { missingTermSlugs?: string[] } } } | null;
      if (!response.ok || !body?.page?.slug) {
        const missing = body?.error?.details?.missingTermSlugs;
        throw new Error(missing?.length ? `${body?.error?.message ?? "연결된 용어를 확인해 주세요."} (${missing.join(", ")})` : body?.error?.message || `위키 문서를 저장하지 못했습니다 (${response.status}).`);
      }
      router.replace(`/w/${body.page.slug}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "위키 문서를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 이 페이지를 나갈까요?")) return;
    router.back();
  }

  return <form onSubmit={submit} className={editing ? "space-y-5 pb-24 lg:flex lg:min-h-[calc(100dvh-3rem)] lg:flex-col" : "space-y-5 lg:flex lg:min-h-[calc(100dvh-6rem)] lg:flex-col"}>
    <div className="grid items-stretch gap-5 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
      <div className="min-w-0 space-y-4 lg:flex lg:flex-col">
        <label className="block"><span className="label">제목</span><input name="title" autoComplete="off" className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="예: 실험 설계 원칙" required /></label>
        {matchingTerms.length > 0 && <div className="note note-warn" role="status">
          <p className="font-medium">이 제목과 일치하는 용어가 있습니다.</p>
          <p className="mt-1 text-sm">뜻·표기·사용 예시를 설명하려면 용어의 상세 설명에 작성하세요. 업무 원칙이나 절차를 정리한다면 위키로 계속 작성할 수 있습니다.</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">{matchingTerms.map((term) => <li key={term.slug}>
            <Link href={`/edit/${encodeURIComponent(term.slug)}#term-body`} className="underline underline-offset-2">{term.nameKo || term.nameEn || term.matchedText} 상세 설명 편집</Link>
          </li>)}</ul>
        </div>}
        <label className="block"><span className="label">요약</span><textarea name="summary" autoComplete="off" className="field min-h-20 resize-y" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={600} placeholder="이 문서가 어떤 업무 판단에 도움을 주는지 한두 문장으로 적어 주세요…" /></label>
        <div className="flex h-80 min-h-64 flex-col lg:h-auto lg:flex-1">
          <span className="label">본문</span>
          <MarkdownEditor
            name="content"
            label="위키 본문"
            describedBy={error ? "wiki-editor-error" : undefined}
            invalid={Boolean(error)}
            value={content}
            onChange={setContent}
            disabled={saving}
            maxLength={200_000}
            defaultView="glossary"
            resizable
            fillAvailable
            onUploadingChange={setImageUploading}
          />
        </div>
      </div>
      <aside className="space-y-4 rounded-xl border border-line bg-panel p-4" aria-label="문서 설정">
      <label className="block"><span className="label">주소</span><input name="slug" autoComplete="off" spellCheck={false} className="field font-mono" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={120} placeholder="비우면 제목으로 자동 생성…" /><span className="mt-1 block text-xs text-ink-3">/w/ 아래 주소입니다. 용어와 같은 주소는 자동으로 피합니다.</span></label>
      <label className="block"><span className="label">원문 출처 URL</span><input name="sourceUrl" autoComplete="off" spellCheck={false} className="field font-mono text-sm" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={2_000} placeholder="https://…" /><span className="mt-1 block text-xs text-ink-3">Confluence 등 원문을 관리하는 곳의 링크입니다.</span></label>
      <label className="block"><span className="label">도메인</span><input name="domain" autoComplete="off" className="field" list="wiki-domain-options" value={domainText} onChange={(event) => setDomainText(event.target.value)} placeholder="예: 상품, 보안…" /><datalist id="wiki-domain-options">{domainOptions.map((item) => <option key={item.key} value={item.label} />)}</datalist><span className="mt-1 block text-xs text-ink-3">쉼표 또는 줄바꿈으로 구분합니다.</span></label>
      <div>
        <label htmlFor="wiki-tag-input" className="label">태그</label>
        <div className="flex min-w-0 gap-2">
          <input
            id="wiki-tag-input"
            list="wiki-tag-options"
            value={tagDraft}
            maxLength={MAX_WIKI_TAG_LENGTH * MAX_WIKI_TAGS + 20}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              addTags();
            }}
            disabled={saving}
            placeholder="태그 입력…"
            className="field min-w-0 flex-1"
          />
          <datalist id="wiki-tag-options">
            {tagOptions.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
          <button type="button" onClick={addTags} disabled={saving || !tagDraft.trim() || Boolean(tagError)} className="btn-ghost btn-sm shrink-0">추가</button>
        </div>
        <p className="mt-1 text-xs text-ink-3">용어 태그처럼 자유롭게 입력합니다. 쉼표나 줄바꿈으로 여러 개를 넣을 수 있습니다.</p>
        {tagError && <p className="mt-1 text-xs text-danger" role="alert">{tagError}</p>}
        {tags.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="태그 목록">
          {tags.map((tag) => <li key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-xs text-ink-2">
            <span className="break-all">#{tag}</span>
            <button type="button" aria-label={tag + " 태그 삭제"} onClick={() => setTags((current) => current.filter((value) => value !== tag))} disabled={saving} className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-brand/40">×</button>
          </li>)}
        </ul>}
      </div>
      <div className="block">
        <label htmlFor="wiki-term-search" className="label">연결할 용어</label>
        <div className="relative">
          <input id="wiki-term-search" autoComplete="off" className="field" value={termQuery}
            onChange={(event) => { setTermQuery(event.target.value); setActiveTerm(-1); }}
            onFocus={() => setTermFocused(true)} onBlur={() => setTermFocused(false)} onKeyDown={onTermKeyDown}
            role="combobox" aria-autocomplete="list" aria-expanded={termDropdownOpen} aria-controls={termDropdownOpen ? termListId : undefined}
            aria-activedescendant={termDropdownOpen && activeTerm >= 0 ? `${termListId}-${activeTerm}` : undefined}
            maxLength={200} disabled={selectedTerms.length >= 20} placeholder={selectedTerms.length >= 20 ? "최대 20개까지 연결할 수 있습니다" : "용어 이름이나 별칭으로 검색…"} />
          {termDropdownOpen && <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-line bg-panel shadow-pop">
            {availableTerms.length > 0 ? <ul id={termListId} role="listbox" aria-label="연결할 용어 검색 결과" className="max-h-64 overflow-y-auto p-1" onMouseDown={(event) => event.preventDefault()}>
              {availableTerms.map((term, index) => <li key={term.slug} id={`${termListId}-${index}`} role="option" aria-selected={activeTerm === index}>
                <button type="button" tabIndex={-1} className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTerm === index ? "bg-panel-2" : ""}`} onMouseEnter={() => setActiveTerm(index)} onClick={() => addTerm(term)}>
                  <span className="block font-medium text-ink">{term.nameKo || term.nameEn || term.matchedText}</span>
                  <span className="block truncate text-xs text-ink-3">{term.nameKo && term.nameEn ? `${term.nameEn} · ` : ""}{term.slug}{term.matchedText !== term.nameKo && term.matchedText !== term.nameEn ? ` · ${term.matchedText}` : ""}</span>
                </button>
              </li>)}
            </ul> : <p className="px-3 py-2 text-sm text-ink-3" role="status">{!termSearchReady ? "검색 중…" : termSearchError ? "용어를 검색하지 못했습니다." : "일치하는 용어가 없습니다."}</p>}
          </div>}
        </div>
        {selectedTerms.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="연결된 용어">
          {selectedTerms.map((term) => <li key={term.slug} className="chip max-w-full gap-1 py-0.5 pl-2.5 pr-1" title={term.slug}>
            <span className="min-w-0 truncate">{term.title}</span>
            <button type="button" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sm leading-none text-ink-3 hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" onClick={() => setSelectedTerms((current) => current.filter((item) => item.slug !== term.slug))} aria-label={`${term.title} 연결 해제`}>×</button>
          </li>)}
        </ul>}
      </div>
      <label className="block"><span className="label">공개 상태</span><select name="status" autoComplete="off" className="field" value={status} onChange={(event) => setStatus(event.target.value as WikiEditorPage["status"])}><option value="draft">초안 · AI 검색 제외</option>{canPublish && <><option value="published">공개 · AI 검색 포함</option><option value="archived">보관 · 검색 제외</option></>}</select>{!canPublish && <span className="mt-1 block text-xs text-ink-3">공개·보관 전환은 관리자 검토 후 처리됩니다.</span>}</label>
      </aside>
    </div>
    {!editing && error && <p id="wiki-editor-error" className="note-danger" role="alert">{error}</p>}
    <div className={editing
      ? "wiki-editor-bottom-bar fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-panel/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur lg:left-60 lg:px-6"
      : "border-t border-line pt-4"}>
      <div className={editing ? "mx-auto w-full max-w-[87rem]" : ""}>
        {editing && error && <p id="wiki-editor-error" className="mb-2 text-sm text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-xs text-ink-3" aria-live="polite">{saving ? "저장 중…" : dirty ? "저장하지 않은 변경사항이 있습니다" : "변경사항 없음"}</p>
          <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>취소</button>
          <button type="submit" className="btn-primary" disabled={saving || imageUploading || !title.trim() || !content.trim() || Boolean(tagError) || (editing && !dirty)}>{imageUploading ? "이미지 변환 중…" : saving ? "저장 중…" : editing ? "변경 저장" : "위키 문서 만들기"}</button>
        </div>
      </div>
    </div>
  </form>;
}
