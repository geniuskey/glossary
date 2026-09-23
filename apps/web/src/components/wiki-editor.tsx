"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";

interface WikiEditorPage {
  id?: string;
  slug?: string;
  title: string;
  summary: string | null;
  sourceUrl?: string | null;
  content?: string;
  domain: string[];
  status: "draft" | "published" | "archived";
  terms: Array<{ slug: string }>;
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

export function WikiEditor({ initialPage, domains: domainOptions, canPublish }: { initialPage: WikiEditorPage | null; domains: DomainOption[]; canPublish: boolean }) {
  const router = useRouter();
  const editing = Boolean(initialPage?.id);
  const [slug, setSlug] = useState(initialPage?.slug ?? "");
  const [title, setTitle] = useState(initialPage?.title ?? "");
  const [summary, setSummary] = useState(initialPage?.summary ?? "");
  const [sourceUrl, setSourceUrl] = useState(initialPage?.sourceUrl ?? "");
  const [domainText, setDomainText] = useState(initialPage?.domain.join(", ") ?? "");
  const [termSlugs, setTermSlugs] = useState(initialPage?.terms.map((term) => term.slug).join(", ") ?? "");
  const [content, setContent] = useState(initialPage?.content ?? "");
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
    || termSlugs !== (initialPage?.terms.map((term) => term.slug).join(", ") ?? "")
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

  const matchingTerms = termMatches?.title === title.trim() ? termMatches.items : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || imageUploading || !title.trim() || !content.trim() || (editing && !dirty)) return;
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
        termSlugs: splitList(termSlugs),
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

  return <form onSubmit={submit} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="label">제목</span><input name="title" autoComplete="off" className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="예: 실험 설계 원칙" required /></label>
      <label className="block"><span className="label">주소</span><input name="slug" autoComplete="off" spellCheck={false} className="field font-mono" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={120} placeholder="비우면 제목으로 자동 생성…" /><span className="mt-1 block text-xs text-ink-3">/w/ 아래 주소입니다. 용어와 같은 주소는 자동으로 피합니다.</span></label>
      {matchingTerms.length > 0 && <div className="note note-warn sm:col-span-2" role="status">
          <p className="font-medium">이 제목과 일치하는 용어가 있습니다.</p>
          <p className="mt-1 text-sm">뜻·표기·사용 예시를 설명하려면 용어의 상세 설명에 작성하세요. 업무 원칙이나 절차를 정리한다면 위키로 계속 작성할 수 있습니다.</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">{matchingTerms.map((term) => <li key={term.slug}>
            <Link href={`/edit/${encodeURIComponent(term.slug)}#term-body`} className="underline underline-offset-2">{term.nameKo || term.nameEn || term.matchedText} 상세 설명 편집</Link>
          </li>)}</ul>
      </div>}
      <label className="block sm:col-span-2"><span className="label">요약</span><textarea name="summary" autoComplete="off" className="field min-h-20 resize-y" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={600} placeholder="이 문서가 어떤 업무 판단에 도움을 주는지 한두 문장으로 적어 주세요…" /></label>
      <label className="block sm:col-span-2"><span className="label">원문 출처 URL</span><input name="sourceUrl" autoComplete="off" spellCheck={false} className="field font-mono text-sm" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={2_000} placeholder="예: https://company.atlassian.net/wiki/spaces/TEAM/pages/…" /><span className="mt-1 block text-xs text-ink-3">Confluence 등 원문을 관리하는 곳의 링크입니다. 위키에는 검토한 결과만 남기고 원문은 이 주소에서 확인합니다.</span></label>
      <label className="block"><span className="label">도메인</span><input name="domain" autoComplete="off" className="field" list="wiki-domain-options" value={domainText} onChange={(event) => setDomainText(event.target.value)} placeholder="예: 상품, 보안…" /><datalist id="wiki-domain-options">{domainOptions.map((item) => <option key={item.key} value={item.label} />)}</datalist><span className="mt-1 block text-xs text-ink-3">쉼표 또는 줄바꿈으로 여러 도메인을 구분합니다.</span></label>
      <label className="block"><span className="label">연결할 용어 슬러그</span><input name="termSlugs" autoComplete="off" spellCheck={false} className="field font-mono" value={termSlugs} onChange={(event) => setTermSlugs(event.target.value)} placeholder="예: experimentation, ab-test…" /><span className="mt-1 block text-xs text-ink-3">쉼표로 구분합니다. 첫 번째 용어가 대표 용어입니다.</span></label>
      <label className="block sm:col-span-2"><span className="label">공개 상태</span><select name="status" autoComplete="off" className="field max-w-xs" value={status} onChange={(event) => setStatus(event.target.value as WikiEditorPage["status"])}><option value="draft">초안 · AI 검색 제외</option>{canPublish && <><option value="published">공개 · AI 검색 포함</option><option value="archived">보관 · 검색 제외</option></>}</select>{!canPublish && <span className="mt-1 block text-xs text-ink-3">공개·보관 전환은 관리자 검토 후 처리됩니다.</span>}</label>
    </div>
    <div>
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
        onUploadingChange={setImageUploading}
      />
    </div>
    {error && <p id="wiki-editor-error" className="note-danger" role="alert">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      <p className="mr-auto text-xs text-ink-3" aria-live="polite">{saving ? "저장 중…" : dirty ? "저장하지 않은 변경사항이 있습니다" : "변경사항 없음"}</p>
      <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>취소</button>
      <button type="submit" className="btn-primary" disabled={saving || imageUploading || !title.trim() || !content.trim() || (editing && !dirty)}>{imageUploading ? "이미지 변환 중…" : saving ? "저장 중…" : editing ? "변경 저장" : "위키 문서 만들기"}</button>
    </div>
  </form>;
}
