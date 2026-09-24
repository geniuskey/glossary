"use client";

import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { HelpTip } from "@/components/help-tip";
import { TermAiReviewPanel } from "@/components/term-ai-review-panel";
import { ClassificationMultiSelect } from "@/components/classification-multi-select";
import { StatusBadge } from "@/components/term-badges";
import {
  TERM_STATUS_HINT,
  TERM_STATUS_LABEL,
} from "@/lib/terms/enums";
import { buildTermPayload, newTermFormState, parseSurfaceBatch, type TermFormState } from "@/lib/terms/form-payload";
import type { EditReviewField } from "@/lib/ai/edit-review-values";
import { interpretResponse, type FormOutcome } from "@/lib/terms/form-response";
import { TERM_DOMAIN_TEXT_MAX, TERM_MARKDOWN_MAX, TERM_NAME_MAX, TERM_SLUG_MAX } from "@/lib/terms/limits";
import type { AssignableUser } from "@/lib/terms/owners";
import type { BusinessCategoryOption } from "@/lib/terms/categories";
import { slugify, slugValidationMessage } from "@/lib/terms/slug";
import { inferSurfaceLang } from "@/lib/terms/surface-language";
import { normalizeTags } from "@/lib/terms/tags";
import { cx } from "@/lib/ui/format";

export interface TermFormInitial extends TermFormState {
  slug?: string;
  // R109: 편집 경로에만 붙는다. 생성 요청 페이로드에는 이 필드 자체가 없어야
  // 한다(schema.ts의 termInputSchema는 이 필드를 모른다 — termPatchSchema만
  // .extend()로 받는다).
  expectedRevision?: number;
}

function commaSeparatedValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function managementSummary(form: TermFormState): string {
  const domainCount = commaSeparatedValues(form.domain).length;
  const categoryCount = commaSeparatedValues(form.category).length;
  const parts = [
    domainCount > 0 ? `도메인 ${domainCount.toLocaleString("ko-KR")}개` : null,
    categoryCount > 0 ? `업무 분류 ${categoryCount.toLocaleString("ko-KR")}개` : null,
    form.tags.length > 0 ? `태그 ${form.tags.length}개` : null,
    form.ownerId ? "담당자 지정" : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "분류·담당자 미지정";
}

// 성공 변형의 warnings 필드 타입만 뽑아낸다. FormOutcome이 이미 유니온이므로
// 조건부 타입을 곧바로 적용하면(나체 타입 매개변수가 아니라서) 분배되지 않고
// never로 무너진다 — 제네릭 T를 한 겹 끼워야 분배 조건부 타입이 된다.
type ExtractWarnings<T> = T extends { kind: "success"; warnings: infer W } ? W : never;
type WarningList = ExtractWarnings<FormOutcome>;

export function TermForm({
  initial,
  assignees = [],
  domainOptions = [],
  categoryOptions = [],
  tagOptions = [],
  canDelete = false,
}: {
  initial?: TermFormInitial;
  assignees?: AssignableUser[];
  domainOptions?: Array<{ label: string; labelEn: string | null }>;
  categoryOptions?: BusinessCategoryOption[];
  tagOptions?: string[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  const editSlug = initial?.slug;
  const compact = editSlug !== undefined;

  const [form, setForm] = useState<TermFormState>(() => {
    const source = initial ?? newTermFormState();
    return {
      ...source,
      surfaces: source.surfaces.map((surface) => ({ ...surface, lang: inferSurfaceLang(surface.text) })),
    };
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renamingSlug, setRenamingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(editSlug ?? "");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [surfaceBatch, setSurfaceBatch] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [showFullNameFields, setShowFullNameFields] = useState(() => Boolean(initial?.fullNameEn || initial?.fullNameKo));
  // R108: 경고가 딸린 저장이 끝나면 이 슬러그가 채워지고, 그때부터 폼은
  // 잠긴다(입력도 비활성화되고 제출 버튼도 링크로 바뀐다) — 그래서 사용자가
  // "저장이 됐는지 몰라서" 또는 "경고를 읽었지만 무심코" 다시 제출해 같은
  // 용어를 두 번 만드는 일이 구조적으로 불가능해진다.
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [expectedRevision, setExpectedRevision] = useState(initial?.expectedRevision);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<WarningList>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [conflict, setConflict] = useState<{ message: string; currentRevision: number | null } | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [showAiReview, setShowAiReview] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const aiReviewButtonRef = useRef<HTMLButtonElement>(null);
  const aiReviewCloseRef = useRef<HTMLButtonElement>(null);
  const aiReviewDrawerRef = useRef<HTMLElement>(null);
  const managementDetailsRef = useRef<HTMLDetailsElement>(null);
  const initialSnapshotRef = useRef(JSON.stringify(buildTermPayload(initial ?? newTermFormState())));

  const locked = saving || deleting || renamingSlug || savedSlug !== null;
  const fieldDisplayLabel: Record<string, string> = {
    nameEn: "대표 영문 용어",
    nameKo: "대표 국문 용어",
    fullNameEn: "영문 확장명",
    fullNameKo: "국문 확장명",
    domain: "도메인",
    category: "업무 분류",
    topic: "태그",
    tags: "태그",
    ownerId: "담당자",
    status: "정리 상태",
    definitionMd: "한줄 정의",
    bodyMd: "본문",
    surfaces: "추가 표기",
  };
  const pendingSurfaceValues = useMemo(() => parseSurfaceBatch(surfaceBatch), [surfaceBatch]);
  const formWithPendingSurfaces = useMemo<TermFormState>(() => ({
    ...form,
    tags: normalizeTags([...form.tags, ...tagDraft.split(/[,\n]+/)]),
    surfaces: [
      ...form.surfaces,
      ...pendingSurfaceValues.map((text) => ({ text, lang: inferSurfaceLang(text), kind: "alias" })),
    ],
  }), [form, pendingSurfaceValues, tagDraft]);
  const formSnapshot = useMemo(() => JSON.stringify(buildTermPayload(formWithPendingSurfaces)), [formWithPendingSurfaces]);
  const dirty = formSnapshot !== initialSnapshotRef.current;
  const latestSubmittedFormRef = useRef(formWithPendingSurfaces);
  const latestDirtyRef = useRef(dirty);
  latestSubmittedFormRef.current = formWithPendingSurfaces;
  latestDirtyRef.current = dirty;
  const normalizedSlug = slugify(slugDraft);
  const slugChanged = editSlug !== undefined && normalizedSlug !== editSlug;
  const slugDraftIssue = slugValidationMessage(normalizedSlug);
  const ManagementContainer = compact ? "section" : "details";
  useUnsavedChanges(dirty && savedSlug === null);

  useEffect(() => {
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  useEffect(() => {
    if (!fieldErrors) return;
    if (fieldErrors.fullNameEn || fieldErrors.fullNameKo) setShowFullNameFields(true);
    if (fieldErrors.surfaces) {
      if (!compact) managementDetailsRef.current!.open = true;
    }
    if (["domain", "category", "tags", "topic", "ownerId"].some((field) => fieldErrors[field])) {
      if (!compact) managementDetailsRef.current!.open = true;
    }
    const firstField = Object.keys(fieldErrors)[0];
    const escapedField = firstField ? CSS.escape(firstField) : null;
    const control = escapedField
      ? document.querySelector<HTMLElement>(`[name="${escapedField}"], [data-field-name="${escapedField}"]`)
      : null;
    (control ?? errorSummaryRef.current)?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!showAiReview) return;
    aiReviewCloseRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAiReview(false);
        aiReviewButtonRef.current?.focus();
      } else if (event.key === "Tab") {
        const focusable = [...(aiReviewDrawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [])].filter((element) => element.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [showAiReview]);

  function updateField<K extends keyof TermFormState>(key: K, value: TermFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setWarnings([]);
    setSaveToast(null);
  }

  function addSurfaceBatch() {
    const values = pendingSurfaceValues;
    if (values.length === 0 || locked) return;

    setForm((current) => ({
      ...current,
      surfaces: [
        ...current.surfaces,
        ...values.map((text) => ({ text, lang: inferSurfaceLang(text), kind: "alias" })),
      ],
    }));
    setSurfaceBatch("");
  }

  function applyAiSuggestion(field: EditReviewField, value: string | string[]) {
    const normalized = Array.isArray(value) ? value.join(", ") : value;
    setForm((current) => field === "topic"
      ? { ...current, tags: normalizeTags([normalized, ...current.tags.slice(1)]) }
      : { ...current, [field]: normalized });
    setWarnings([]);
    setSaveToast(null);
    if (field === "fullNameEn" || field === "fullNameKo") setShowFullNameFields(true);
    if (!compact && (field === "domain" || field === "category" || field === "topic")) managementDetailsRef.current!.open = true;
  }

  function removeSurface(index: number) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.filter((_, i) => i !== index) }));
    setWarnings([]);
  }

  function addTags() {
    const values = normalizeTags([...form.tags, ...tagDraft.split(/[,\n]+/)]);
    if (locked) return;
    if (values.length !== form.tags.length) updateField("tags", values);
    setTagDraft("");
  }

  function handleSurfaceBatchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    addSurfaceBatch();
  }

  function errorsFor(field: string): string[] | undefined {
    return fieldErrors?.[field];
  }

  async function renameSlug() {
    if (editSlug === undefined || locked || dirty || !slugChanged) return;
    if (slugDraftIssue) {
      setSlugError(slugDraftIssue);
      return;
    }

    setRenamingSlug(true);
    setSlugError(null);
    try {
      const response = await fetch(`/api/v1/terms/${encodeURIComponent(editSlug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slugDraft, expectedRevision }),
      });
      const body = await response.json().catch(() => null) as {
        term?: { slug?: string };
        error?: { code?: string; message?: string };
      } | null;

      if (!response.ok || !body?.term?.slug) {
        const fallback = body?.error?.code === "revision_conflict"
          ? "다른 사람이 먼저 수정했습니다. 새로고침한 뒤 다시 시도해 주세요."
          : "URL 주소를 변경하지 못했습니다.";
        setSlugError(body?.error?.message || fallback);
        return;
      }

      const nextSlug = body.term.slug;
      setSlugDraft(nextSlug);
      setExpectedRevision((revision) => revision === undefined ? undefined : revision + 1);
      router.replace(`/edit/${encodeURIComponent(nextSlug)}`);
      router.refresh();
    } catch {
      setSlugError("네트워크 오류로 URL 주소를 변경하지 못했습니다.");
    } finally {
      setRenamingSlug(false);
    }
  }

  async function deleteCurrentTerm() {
    if (editSlug === undefined || !canDelete || locked) return;
    const label = form.nameKo.trim() || form.nameEn.trim() || editSlug;
    if (!window.confirm(`"${label}" 용어를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    setDeleting(true);
    setErrorMessage(null);
    setIssues(null);
    setFieldErrors(null);
    setConflict(null);

    try {
      const response = await fetch(`/api/v1/terms/${encodeURIComponent(editSlug)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setErrorMessage(body?.error?.message ?? `삭제하지 못했습니다 (${response.status}).`);
        setDeleting(false);
        return;
      }
      router.replace("/sheet");
      router.refresh();
    } catch {
      setErrorMessage("네트워크 오류로 삭제하지 못했습니다.");
      setDeleting(false);
    }
  }

  async function submitForm() {
    // R108: 방어선 두 번째 겹. 버튼이 이미 링크로 바뀐 뒤라도 Enter 키 등으로
    // submit 이벤트가 다시 뜰 수 있는 경로를 여기서도 막는다.
    if (locked) return;
    if (imageUploading) return;
    if (editSlug !== undefined && !latestDirtyRef.current) return;

    setSaving(true);
    setErrorMessage(null);
    setIssues(null);
    setFieldErrors(null);
    setConflict(null);

    const submittedForm = latestSubmittedFormRef.current;
    const payload = buildTermPayload(submittedForm, expectedRevision);
    // dirty 비교용 스냅샷에는 요청 경합용 expectedRevision을 넣지 않는다.
    const submittedSnapshot = JSON.stringify(buildTermPayload(submittedForm));
    const url = editSlug !== undefined ? `/api/v1/terms/${editSlug}` : "/api/v1/terms";
    const method = editSlug !== undefined ? "PATCH" : "POST";

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setSaving(false);
      setErrorMessage("네트워크 오류로 저장하지 못했습니다.");
      return;
    }

    const body = await res.json().catch(() => null);
    const outcome = interpretResponse(res.status, res.ok, body);
    setSaving(false);

    if (outcome.kind === "success") {
      if (editSlug !== undefined) {
        // 수정 화면은 저장 뒤에도 같은 맥락에서 계속 다듬을 수 있어야 한다.
        // 현재 입력을 새 기준점으로 삼고 리비전만 올려 다음 저장의 경합 검사를
        // 이어 간다. 상세 화면 이동은 사용자가 취소 링크를 눌렀을 때만 일어난다.
        initialSnapshotRef.current = submittedSnapshot;
        if (outcome.term.status) {
          setForm((current) => ({ ...current, status: outcome.term.status! }));
        }
        setExpectedRevision((revision) => revision === undefined ? undefined : revision + 1);
        setWarnings(outcome.warnings);
        setSaveToast(outcome.warnings.length > 0
          ? `저장했습니다. 겹치는 추가 표기 ${outcome.warnings.length}개를 확인해 주세요.`
          : "변경사항을 저장했습니다. 정리 상태는 시스템이 자동으로 판정합니다.");
        return;
      }
      if (outcome.warnings.length > 0) {
        // R108: 동음이의어 경고가 있으면 곧장 상세 화면으로 넘어가지 않는다.
        // 계획서 스케치는 여기서도 무조건 router.push했는데, 그러면 경고를 볼
        // 새도 없이 화면이 넘어가고, 사용자가 "저장이 안 된 줄 알고" 뒤로가기
        // 후 다시 제출하면 createTerm이 한 번 더 실행되어 완전히 새로운 중복
        // 용어가 생긴다(실측 재현 — 아래 보고 참고).
        setWarnings(outcome.warnings);
        setSavedSlug(outcome.term.slug);
      } else {
        router.push(`/g/${outcome.term.slug}`);
        router.refresh();
      }
      return;
    }

    if (outcome.kind === "conflict") {
      // R109: 리비전 경합은 검증 실패나 일반 오류와 구분해서 보여준다 —
      // "누가 먼저 저장했다"는 사실과 "새로고침 후 다시 시도"라는 행동을
      // 명확히 안내해야, 사용자가 옛 내용으로 덮어쓰는 걸 스스로 막을 수 있다.
      setConflict({ message: outcome.message, currentRevision: outcome.currentRevision });
      return;
    }

    if (outcome.kind === "issues") {
      setIssues(outcome.issues);
      setErrorMessage(outcome.message);
      return;
    }

    if (outcome.kind === "fieldErrors") {
      setFieldErrors(outcome.fieldErrors);
      setErrorMessage(outcome.message);
      return;
    }

    setErrorMessage(outcome.message);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.matches("[data-live-table-cell]")) {
      activeElement.blur();
      // 표 셀은 포커스가 빠질 때 Markdown 원문을 확정한다. 다음 프레임까지
      // 기다려 최신 원문이 ref에 반영된 뒤 제출해야 마지막 입력이 빠지지 않는다.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    await submitForm();
  }

  return (
    <form onSubmit={onSubmit} className={cx("w-full", compact ? "flex min-h-[calc(100dvh-6rem)] flex-col gap-3 pb-24" : "space-y-5")}>
      {conflict && (
        <div className="note note-warn" aria-live="polite">
          <p className="font-medium">{conflict.message}</p>
          {conflict.currentRevision !== null && (
            <p className="mt-0.5 text-xs opacity-80">서버의 현재 리비전 #{conflict.currentRevision}</p>
          )}
          <button type="button" onClick={() => window.location.reload()} className="btn-ghost btn-sm mt-2">
            새로고침
          </button>
        </div>
      )}

      {errorMessage && !conflict && (
        <div ref={errorSummaryRef} tabIndex={-1} className="note note-danger" aria-live="polite">
          <p className="font-medium">{errorMessage}</p>
          {issues && (
            <ul className="mt-1 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {fieldErrors && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(fieldErrors).map(([field, errs]) => (
                <li key={field}>
                  {fieldDisplayLabel[field] ?? field}: {errs.join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="note note-warn" aria-live="polite">
          <p className="mb-1 font-medium">같은 표기의 다른 용어가 있습니다</p>
          <ul className="space-y-0.5">
            {warnings.map((w) => (
              <li key={`${w.surfaceText}:${w.conflictingSlug}`}>
                {w.surfaceText} →{" "}
                <Link href={`/g/${w.conflictingSlug}`} className="underline underline-offset-2">
                  {w.conflictingSlug}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cx(compact ? "grid min-h-0 flex-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]" : "space-y-5")}>
      <div className={cx(compact ? "flex min-w-0 flex-col gap-3" : "space-y-5")}>
      <section className="card">
        <CompactSectionTitle
          compact={compact}
          title="이름과 정의"
          description="대표 이름과 짧은 정의처럼 가장 자주 확인하는 정보를 관리합니다."
          action={(
            <div className="ml-auto flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs font-medium text-ink-2">정리 상태</span>
                <HelpTip text={TERM_STATUS_HINT[form.status]} />
                <span title={TERM_STATUS_HINT[form.status]} aria-label={`정리 상태: ${TERM_STATUS_LABEL[form.status]}. ${TERM_STATUS_HINT[form.status]}`}>
                  <StatusBadge status={form.status} />
                </span>
              </span>
            </div>
          )}
        />
        <div className={compact ? "space-y-3 p-3" : "space-y-5 p-4 sm:p-5"}>
            <FormFieldError id="status-error" errors={errorsFor("status")} />
            <div className={cx("grid sm:grid-cols-2", compact ? "gap-2" : "gap-3")}>
              <FormTextField
                name="nameEn"
                label="대표 영문 용어"
                hint="목록과 페이지 제목에 먼저 표시할 대표 용어를 하나 이상 입력합니다."
                value={form.nameEn}
                errors={errorsFor("nameEn")}
                maxLength={TERM_NAME_MAX}
                disabled={locked}
                onChange={(value) => updateField("nameEn", value)}
              />
              <FormTextField
                name="nameKo"
                label="대표 국문 용어"
                value={form.nameKo}
                errors={errorsFor("nameKo")}
                maxLength={TERM_NAME_MAX}
                disabled={locked}
                onChange={(value) => updateField("nameKo", value)}
              />

              {(showFullNameFields || form.fullNameEn || form.fullNameKo) ? (
                <>
                  <FormTextField
                    name="fullNameEn"
                    label="영문 확장명"
                    value={form.fullNameEn}
                    errors={errorsFor("fullNameEn")}
                    maxLength={TERM_NAME_MAX}
                    disabled={locked}
                    onChange={(value) => updateField("fullNameEn", value)}
                  />
                  <FormTextField
                    name="fullNameKo"
                    label="국문 확장명"
                    value={form.fullNameKo}
                    errors={errorsFor("fullNameKo")}
                    maxLength={TERM_NAME_MAX}
                    disabled={locked}
                    onChange={(value) => updateField("fullNameKo", value)}
                  />
                </>
              ) : (
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setShowFullNameFields(true)}
                    className="btn-quiet btn-sm"
                  >
                    + 확장명 추가
                  </button>
                </div>
              )}

            </div>

            <div className={cx("border-t border-line", compact ? "pt-3" : "pt-4")}>
              <div className={cx("flex items-baseline gap-2", compact ? "mb-2" : "mb-3")}>
                <h3 className="text-sm font-medium text-ink">한줄 정의</h3>
                <HelpTip text="검색 결과에서 먼저 읽히는 짧은 설명입니다." />
              </div>
              <textarea
                name="definitionMd"
                autoComplete="off"
                value={form.definitionMd}
                maxLength={TERM_MARKDOWN_MAX}
                onChange={(event) => updateField("definitionMd", event.target.value)}
                disabled={locked}
                aria-label="한줄 정의"
                aria-invalid={errorsFor("definitionMd") ? true : undefined}
                aria-describedby={errorsFor("definitionMd") ? "definitionMd-error" : undefined}
                rows={compact ? 2 : 3}
                placeholder="한두 문장으로 이 용어가 무엇인지…"
                className="field korean-editor-font"
              />
              <FormFieldError id="definitionMd-error" errors={errorsFor("definitionMd")} />
            </div>
        </div>
      </section>

      <section id="term-body" className={cx("card overflow-hidden", compact && "flex min-h-0 flex-1 flex-col")}>
        <CompactSectionTitle
          compact={compact}
          title="상세 설명"
          description="예시나 배경처럼 한줄 정의만으로 부족한 맥락을 남깁니다."
          action={editSlug !== undefined ? (
            <button
              ref={aiReviewButtonRef}
              type="button"
              onClick={() => setShowAiReview(true)}
              disabled={locked || imageUploading}
              className="btn-ghost btn-sm ml-auto"
              aria-haspopup="dialog"
              aria-controls="term-ai-review-drawer"
            >
              AI 검토
            </button>
          ) : undefined}
        />
        <div className={cx(compact && "flex min-h-0 flex-1 flex-col")}>
          <MarkdownEditor
            name="bodyMd"
            label="용어 본문"
            describedBy={errorsFor("bodyMd") ? "bodyMd-error" : undefined}
            invalid={Boolean(errorsFor("bodyMd"))}
            value={form.bodyMd}
            maxLength={TERM_MARKDOWN_MAX}
            onChange={(bodyMd) => updateField("bodyMd", bodyMd)}
            disabled={locked}
            compact={compact}
            resizable={compact}
            fillAvailable={compact}
            defaultView="glossary"
            embedded
            onUploadingChange={setImageUploading}
          />
          {errorsFor("bodyMd") && (
            <div className="px-3 pb-3">
              <FormFieldError id="bodyMd-error" errors={errorsFor("bodyMd")} />
            </div>
          )}
        </div>
      </section>

      </div>

      <aside className="min-w-0" aria-label="용어 설정">
      <ManagementContainer
        ref={(node) => { managementDetailsRef.current = node instanceof HTMLDetailsElement ? node : null; }}
        className="group/details card h-full"
      >
            {compact ? (
              <header className="border-b border-line px-3 py-3">
                <h2 className="text-sm font-semibold text-ink">용어 설정</h2>
              </header>
            ) : (
              <CollapsibleSectionSummary
                title="부가 정보"
                summary={`${form.surfaces.length > 0 ? `추가 표기 ${form.surfaces.length}개` : "추가 표기 없음"} · ${managementSummary(form)}`}
              />
            )}
            <div className={compact ? "p-3 pt-0" : "p-4 pt-0 sm:p-5 sm:pt-0"}>
              <section aria-labelledby="surfaces-heading" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2">
                <h3 id="surfaces-heading" className="col-span-2 text-sm font-medium text-ink">추가 표기</h3>
                <input
                  id="surface-batch"
                  name="surfaceBatch"
                  data-field-name="surfaces"
                  aria-label="추가 표기 입력"
                  autoComplete="off"
                  value={surfaceBatch}
                  maxLength={TERM_NAME_MAX * 10}
                  disabled={locked}
                  aria-invalid={errorsFor("surfaces") ? true : undefined}
                  aria-describedby={errorsFor("surfaces") ? "surfaces-error" : undefined}
                  placeholder="쉼표로 구분해 입력…"
                  onChange={(event) => setSurfaceBatch(event.target.value)}
                  onKeyDown={handleSurfaceBatchKeyDown}
                  className="field h-8 min-w-0 py-0"
                />
                <button
                  type="button"
                  onClick={addSurfaceBatch}
                  disabled={locked || pendingSurfaceValues.length === 0}
                  className="btn-primary btn-sm touch-manipulation"
                >
                  <IconPlus />표기 추가
                </button>
                {form.surfaces.length > 0 && (
                  <ul className="col-span-2 flex flex-wrap gap-2" aria-label="추가 표기 목록">
                    {form.surfaces.map((surface, index) => (
                      <li key={index} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-xs font-medium text-ink-2">
                        <span className="min-w-0 break-all">{surface.text}</span>
                        <button
                          type="button"
                          aria-label={(surface.text || "추가 표기 " + (index + 1)) + " 삭제"}
                          onClick={() => removeSurface(index)}
                          disabled={locked}
                          className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <FormFieldError id="surfaces-error" errors={errorsFor("surfaces")} className="col-span-2" />
              </section>
            <div className="mt-3 border-t border-line pt-3">
            <div className={cx("grid gap-3", !compact && "md:grid-cols-2 xl:grid-cols-4")}>
            <div>
              <ClassificationMultiSelect
                name="domain"
                label="도메인"
                help="여러 도메인을 선택할 수 있습니다. 등록되지 않은 값은 분류 체계에서 먼저 추가합니다."
                placeholder="도메인 검색…"
                selected={commaSeparatedValues(form.domain)}
                initialOptions={domainOptions.map((domain) => ({ value: domain.label, label: domain.label, secondaryLabel: domain.labelEn ?? undefined }))}
                kind="domain"
                manageHref="/classifications"
                refresh={{ url: "/api/v1/admin/domains", responseKey: "domains" }}
                disabled={locked}
                invalid={Boolean(errorsFor("domain"))}
                describedBy={errorsFor("domain") ? "domain-error" : undefined}
                onChange={(values) => updateField("domain", values.join(", "))}
              />
              <FormFieldError id="domain-error" errors={errorsFor("domain")} />
            </div>
            <div>
              <ClassificationMultiSelect
                name="category"
                label="업무 분류"
                help="여러 업무 분류를 선택할 수 있습니다. 등록되지 않은 값은 분류 체계에서 먼저 추가합니다."
                placeholder="업무 분류 검색…"
                selected={commaSeparatedValues(form.category)}
                initialOptions={categoryOptions.map((category) => ({
                  value: category.key,
                  label: category.labelKo,
                  secondaryLabel: category.labelEn ?? undefined,
                }))}
                kind="category"
                manageHref="/classifications?view=categories"
                refresh={{ url: "/api/v1/admin/categories", responseKey: "categories" }}
                disabled={locked}
                invalid={Boolean(errorsFor("category"))}
                describedBy={errorsFor("category") ? "category-error" : undefined}
                onChange={(values) => updateField("category", values.join(", "))}
              />
              <FormFieldError id="category-error" errors={errorsFor("category")} />
            </div>
            <div>
              <label htmlFor="term-tag-input" className="label">태그</label>
              <div className="flex min-w-0 gap-2">
                <input
                  id="term-tag-input"
                  data-field-name="tags"
                  aria-label="태그 입력"
                  aria-invalid={errorsFor("tags") ? true : undefined}
                  aria-describedby={errorsFor("tags") ? "tags-error" : undefined}
                  list="term-tag-options"
                  value={tagDraft}
                  maxLength={TERM_NAME_MAX * 20}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    addTags();
                  }}
                  disabled={locked}
                  placeholder="태그 입력…"
                  className="field min-w-0 flex-1"
                />
                <datalist id="term-tag-options">
                  {tagOptions.map((tag) => <option key={tag} value={tag} />)}
                </datalist>
                <button type="button" onClick={addTags} disabled={locked || !tagDraft.trim()} className="btn-ghost btn-sm shrink-0">추가</button>
              </div>
              {form.tags.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="태그 목록">
                  {form.tags.map((tag) => (
                    <li key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-xs text-ink-2">
                      <span className="break-all">#{tag}</span>
                      <button type="button" aria-label={`${tag} 태그 삭제`} onClick={() => updateField("tags", form.tags.filter((value) => value !== tag))} disabled={locked} className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-brand/40">×</button>
                    </li>
                  ))}
                </ul>
              )}
              <FormFieldError id="tags-error" errors={errorsFor("tags") ?? errorsFor("topic")} />
            </div>

            <label className="block">
              <span className="label">담당자</span>
              <select
                name="ownerId"
                value={form.ownerId}
                onChange={(event) => updateField("ownerId", event.target.value)}
                disabled={locked}
                aria-invalid={errorsFor("ownerId") ? true : undefined}
                aria-describedby={errorsFor("ownerId") ? "ownerId-error" : undefined}
                className="field"
              >
                <option value="">미지정 · 누구나 정리</option>
                {assignees.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
              </select>
              <FormFieldError id="ownerId-error" errors={errorsFor("ownerId")} />
            </label>
            </div>

            {editSlug !== undefined && (
              <details className="mt-3 rounded-lg border border-line bg-panel-2/35">
                <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-xs font-medium text-ink-2 focus-visible:ring-2 focus-visible:ring-brand/40">URL 주소 변경</summary>
                <div className="border-t border-line p-3">
                <span className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                  URL 주소
                  <HelpTip text={dirty ? "다른 변경사항을 먼저 저장해야 URL을 변경할 수 있습니다." : normalizedSlug && normalizedSlug !== slugDraft ? `실제 주소: /g/${normalizedSlug}` : "글자·숫자와 하이픈으로 정리되어 저장됩니다."} />
                </span>
                <label htmlFor="term-slug" className="sr-only">URL 주소</label>
                <div className="flex overflow-hidden rounded-lg border border-line bg-panel focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                  <span className="flex shrink-0 items-center border-r border-line bg-panel-2 px-2.5 text-xs text-ink-3">/g/</span>
                  <input
                    id="term-slug"
                    name="slug"
                    autoComplete="off"
                    value={slugDraft}
                    maxLength={TERM_SLUG_MAX}
                    disabled={locked}
                    aria-invalid={slugError ? true : undefined}
                    aria-describedby={slugError ? "term-slug-error" : undefined}
                    onChange={(event) => {
                      setSlugDraft(event.target.value);
                      setSlugError(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                {slugError && <p id="term-slug-error" className="mt-1 text-xs text-danger" aria-live="polite">{slugError}</p>}
                <button
                  type="button"
                  onClick={() => void renameSlug()}
                  disabled={locked || dirty || !slugChanged || Boolean(slugDraftIssue)}
                  className="btn-ghost btn-sm mt-2 w-full"
                >
                  {renamingSlug ? "URL 변경 중…" : "URL 변경"}
                </button>
                </div>
              </details>
            )}
            {editSlug !== undefined && canDelete && (
              <div className="mt-3 border-t border-line pt-3">
                <button type="button" onClick={() => void deleteCurrentTerm()} disabled={locked} className="btn-danger btn-sm">
                  {deleting ? "삭제 중…" : "용어 삭제"}
                </button>
              </div>
            )}
          </div>
          </div>
      </ManagementContainer>
      </aside>
      </div>

      <div className={cx(
        compact
          ? "term-form-bottom-bar fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-panel/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur lg:left-60 lg:px-6"
          : "sticky bottom-3 z-10 rounded-xl border border-line bg-panel/95 px-3 py-2.5 shadow-lg backdrop-blur",
      )}>
        <div className={cx("flex items-center justify-between gap-3", compact && "mx-auto w-full max-w-[87rem]")}>
          <p className={cx("min-w-0 truncate text-xs text-ink-3", compact && "hidden sm:block")} aria-live="polite">
            {deleting ? "삭제 중…" : saving ? "저장 중…" : savedSlug ? "저장 완료" : editSlug === undefined ? "새 용어 작성 중" : dirty ? "저장하지 않은 변경사항이 있습니다" : "변경사항 없음"}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Link href={editSlug !== undefined ? `/g/${editSlug}` : "/sheet"} className="btn-quiet">
              취소
            </Link>
            {savedSlug ? (
              <Link href={`/g/${savedSlug}`} className="btn-primary">
                저장됨 → {savedSlug}로 이동
              </Link>
            ) : (
              <button type="submit" disabled={saving || imageUploading || (editSlug !== undefined && !dirty)} className="btn-primary">
                {imageUploading ? "이미지 변환 중…" : saving ? "저장 중…" : editSlug === undefined ? "용어 저장" : "변경사항 저장"}
              </button>
            )}
          </div>
        </div>
      </div>

      {editSlug !== undefined && (
        <>
          <button
            type="button"
            tabIndex={showAiReview ? 0 : -1}
            aria-label="AI 검토 닫기"
            onClick={() => {
              setShowAiReview(false);
              aiReviewButtonRef.current?.focus();
            }}
            className={cx("fixed inset-0 z-[70] bg-black/45", showAiReview ? "block" : "hidden")}
          />
          <aside
            ref={aiReviewDrawerRef}
            id="term-ai-review-drawer"
            role="dialog"
            aria-modal={showAiReview ? "true" : undefined}
            aria-label="AI 검토"
            inert={!showAiReview}
            className={cx(
              "fixed inset-y-0 right-0 z-[71] w-full max-w-xl flex-col overflow-y-auto overscroll-contain border-l border-line bg-panel p-4 shadow-2xl sm:p-6",
              showAiReview ? "flex" : "hidden",
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">AI 검토</h2>
                <p className="mt-1 text-xs text-ink-3">제안을 반영한 뒤 변경사항을 저장하세요.</p>
              </div>
              <button
                ref={aiReviewCloseRef}
                type="button"
                onClick={() => {
                  setShowAiReview(false);
                  aiReviewButtonRef.current?.focus();
                }}
                className="btn-quiet btn-sm"
              >
                닫기
              </button>
            </div>
            <TermAiReviewPanel
              termSlug={editSlug}
              payload={buildTermPayload(formWithPendingSurfaces)}
              disabled={locked || imageUploading}
              onApply={applyAiSuggestion}
            />
          </aside>
        </>
      )}

      {saveToast && (
        <div className={cx("fixed right-5 z-[80] flex max-w-sm items-center gap-3 rounded-lg border border-ok/35 bg-ok-soft px-4 py-3 text-sm text-ok shadow-pop animate-fade-up", compact ? "bottom-20" : "bottom-5")} role="status" aria-live="polite">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok text-xs font-bold text-panel" aria-hidden="true">✓</span>
          <span className="min-w-0 flex-1">{saveToast}</span>
          <button type="button" className="text-base leading-none opacity-60 hover:opacity-100" aria-label="알림 닫기" onClick={() => setSaveToast(null)}>×</button>
        </div>
      )}
    </form>
  );
}

function CompactSectionTitle({
  title,
  description,
  compact = false,
  action,
}: {
  title: string;
  description: string;
  compact?: boolean;
  action?: ReactNode;
}) {
  return (
    <header className={cx("flex flex-wrap items-center rounded-t-xl border-b border-line bg-panel-2/50", compact ? "gap-x-2 px-3 py-2" : "gap-2 px-4 py-3 sm:px-5")}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <HelpTip text={description} />
      {action}
    </header>
  );
}

function CollapsibleSectionSummary({ title, summary }: { title: string; summary: string }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-3 focus-visible:ring-2 focus-visible:ring-brand/40 sm:px-4 [&::-webkit-details-marker]:hidden">
      <span role="heading" aria-level={2} className="text-sm font-semibold text-ink">{title}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{summary}</span>
      <span className="shrink-0 text-sm text-ink-3 transition-transform group-open/details:rotate-180" aria-hidden="true">⌄</span>
    </summary>
  );
}

function FormTextField({
  name,
  label,
  value,
  errors,
  maxLength,
  disabled,
  placeholder,
  hint,
  suggestions,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  errors?: string[];
  maxLength: number;
  disabled: boolean;
  placeholder?: string;
  hint?: string;
  suggestions?: string[];
  onChange: (value: string) => void;
}) {
  const errorId = `${name}-error`;
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);

  function toggleSuggestion(suggestion: string) {
    const next = selected.includes(suggestion)
      ? selected.filter((item) => item !== suggestion)
      : [...selected, suggestion];
    onChange(next.join(", "));
  }
  return (
    <div className="block min-w-0">
      <span className="label inline-flex items-center gap-1.5"><label htmlFor={`term-${name}`}>{label}</label>{hint && <HelpTip text={hint} />}</span>
      <input
        id={`term-${name}`}
        name={name}
        autoComplete="off"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? errorId : undefined}
        className="field"
      />
      {suggestions && suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label={`${label} 선택지`}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              aria-pressed={selected.includes(suggestion)}
              onClick={() => toggleSuggestion(suggestion)}
              className={cx("chip !py-0.5 !text-[11px]", selected.includes(suggestion) && "chip-on")}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <FormFieldError id={errorId} errors={errors} />
    </div>
  );
}

function FormFieldError({ id, errors, className }: { id: string; errors?: string[]; className?: string }) {
  if (!errors || errors.length === 0) return null;
  return (
    <span id={id} className={cx("mt-1.5 block text-xs leading-5 text-danger", className)}>
      {errors.join(" ")}
    </span>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}
