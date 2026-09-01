"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  EXPLICIT_SURFACE_KINDS,
  SURFACE_KIND_LABEL,
  SURFACE_LANGS,
  TERM_STATUSES,
  TERM_STATUS_HINT,
  TERM_STATUS_LABEL,
  TERM_TYPES,
  TERM_TYPE_LABEL,
  type ExplicitSurfaceKindLiteral,
  type SurfaceLangLiteral,
  type TermStatusLiteral,
  type TermTypeLiteral,
} from "@/lib/terms/enums";
import { TERM_FIELD_LABELS } from "@/lib/terms/form-labels";
import { buildTermPayload, parseSurfaceBatch, type SurfaceDraft, type TermFormState } from "@/lib/terms/form-payload";
import { interpretResponse, type FormOutcome } from "@/lib/terms/form-response";
import { TERM_DOMAIN_TEXT_MAX, TERM_MARKDOWN_MAX, TERM_NAME_MAX, TERM_SLUG_MAX } from "@/lib/terms/limits";
import type { AssignableUser } from "@/lib/terms/owners";
import type { BusinessCategoryOption } from "@/lib/terms/categories";
import { slugify, slugValidationMessage } from "@/lib/terms/slug";

export interface TermFormInitial extends TermFormState {
  slug?: string;
  // R109: 편집 경로에만 붙는다. 생성 요청 페이로드에는 이 필드 자체가 없어야
  // 한다(schema.ts의 termInputSchema는 이 필드를 모른다 — termPatchSchema만
  // .extend()로 받는다).
  expectedRevision?: number;
}

// F6/P1(query.ts의 규약): `Record<유니온, T>` + 폴백 없음. 화면에 "neutral"이
// 그대로 노출되면 사용자는 그게 언어 코드인지 상태인지 알 수 없다.
const LANG_LABEL: Record<SurfaceLangLiteral, string> = {
  en: "영문",
  ko: "국문",
  neutral: "공통",
};

const EMPTY: TermFormState = {
  termType: "concept",
  nameEn: "",
  nameKo: "",
  fullNameEn: "",
  fullNameKo: "",
  domain: "",
  category: "",
  topic: "",
  ownerId: "",
  status: "draft",
  definitionMd: "",
  bodyMd: "",
  surfaces: [],
};

// 성공 변형의 warnings 필드 타입만 뽑아낸다. FormOutcome이 이미 유니온이므로
// 조건부 타입을 곧바로 적용하면(나체 타입 매개변수가 아니라서) 분배되지 않고
// never로 무너진다 — 제네릭 T를 한 겹 끼워야 분배 조건부 타입이 된다.
type ExtractWarnings<T> = T extends { kind: "success"; warnings: infer W } ? W : never;
type WarningList = ExtractWarnings<FormOutcome>;

export function TermForm({
  initial,
  assignees = [],
  categoryOptions = [],
}: {
  initial?: TermFormInitial;
  assignees?: AssignableUser[];
  categoryOptions?: BusinessCategoryOption[];
}) {
  const router = useRouter();
  const editSlug = initial?.slug;

  const [form, setForm] = useState<TermFormState>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [renamingSlug, setRenamingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(editSlug ?? "");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [surfaceBatch, setSurfaceBatch] = useState("");
  const [surfaceBatchKind, setSurfaceBatchKind] = useState<ExplicitSurfaceKindLiteral>("alias");
  const [surfaceBatchLang, setSurfaceBatchLang] = useState<SurfaceLangLiteral>("neutral");
  const [draggedSurfaceIndex, setDraggedSurfaceIndex] = useState<number | null>(null);
  const [dragOverSurfaceKind, setDragOverSurfaceKind] = useState<ExplicitSurfaceKindLiteral | null>(null);
  const [surfaceAnnouncement, setSurfaceAnnouncement] = useState("");
  // R108: 경고가 딸린 저장이 끝나면 이 슬러그가 채워지고, 그때부터 폼은
  // 잠긴다(입력도 비활성화되고 제출 버튼도 링크로 바뀐다) — 그래서 사용자가
  // "저장이 됐는지 몰라서" 또는 "경고를 읽었지만 무심코" 다시 제출해 같은
  // 용어를 두 번 만드는 일이 구조적으로 불가능해진다.
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<WarningList>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [conflict, setConflict] = useState<{ message: string; currentRevision: number | null } | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const initialSnapshotRef = useRef(JSON.stringify(buildTermPayload(initial ?? EMPTY)));

  const locked = saving || renamingSlug || savedSlug !== null;
  const labels = TERM_FIELD_LABELS[form.termType as TermTypeLiteral] ?? TERM_FIELD_LABELS.concept;
  const fieldDisplayLabel: Record<string, string> = {
    termType: "용어 종류",
    nameEn: labels.nameEn,
    nameKo: labels.nameKo,
    fullNameEn: labels.fullNameEn,
    fullNameKo: labels.fullNameKo,
    domain: "도메인",
    category: "업무 분류",
    topic: "주제",
    ownerId: "담당자",
    status: "공개 상태",
    definitionMd: "정의",
    bodyMd: "본문",
    surfaces: "추가 표기",
  };
  const pendingSurfaceValues = useMemo(() => parseSurfaceBatch(surfaceBatch), [surfaceBatch]);
  const formWithPendingSurfaces = useMemo<TermFormState>(() => ({
    ...form,
    surfaces: [
      ...form.surfaces,
      ...pendingSurfaceValues.map((text) => ({ text, lang: surfaceBatchLang, kind: surfaceBatchKind })),
    ],
  }), [form, pendingSurfaceValues, surfaceBatchKind, surfaceBatchLang]);
  const formSnapshot = useMemo(() => JSON.stringify(buildTermPayload(formWithPendingSurfaces)), [formWithPendingSurfaces]);
  const dirty = formSnapshot !== initialSnapshotRef.current;
  const normalizedSlug = slugify(slugDraft);
  const slugChanged = editSlug !== undefined && normalizedSlug !== editSlug;
  const slugDraftIssue = slugValidationMessage(normalizedSlug);
  const usedSurfaceKinds = EXPLICIT_SURFACE_KINDS.filter((kind) => form.surfaces.some((surface) => surface.kind === kind));

  useEffect(() => {
    if (!dirty || savedSlug !== null) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (window.confirm("저장하지 않은 변경사항이 있습니다. 이 페이지를 나갈까요?")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeLinkNavigation, true);
    };
  }, [dirty, savedSlug]);

  useEffect(() => {
    if (!fieldErrors) return;
    const firstField = Object.keys(fieldErrors)[0];
    const control = firstField ? document.querySelector<HTMLElement>(`[name="${CSS.escape(firstField)}"]`) : null;
    (control ?? errorSummaryRef.current)?.focus();
  }, [fieldErrors]);

  function updateField<K extends keyof TermFormState>(key: K, value: TermFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateSurface(index: number, patch: Partial<SurfaceDraft>) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addSurfaceBatch() {
    const values = pendingSurfaceValues;
    if (values.length === 0 || locked) return;

    setForm((current) => ({
      ...current,
      surfaces: [
        ...current.surfaces,
        ...values.map((text) => ({ text, lang: surfaceBatchLang, kind: surfaceBatchKind })),
      ],
    }));
    setSurfaceBatch("");
    setSurfaceAnnouncement(`${SURFACE_KIND_LABEL[surfaceBatchKind]}에 표기 ${values.length}개를 추가했습니다.`);
  }

  function removeSurface(index: number) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.filter((_, i) => i !== index) }));
  }

  function moveSurface(index: number, kind: ExplicitSurfaceKindLiteral) {
    const surface = form.surfaces[index];
    if (!surface || surface.kind === kind) return;
    updateSurface(index, { kind });
    setSurfaceAnnouncement(`${surface.text || `추가 표기 ${index + 1}`}을(를) ${SURFACE_KIND_LABEL[kind]}으로 이동했습니다.`);
  }

  function handleSurfaceBatchKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    addSurfaceBatch();
  }

  function handleSurfaceDragStart(event: DragEvent<HTMLElement>, index: number) {
    if (locked) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedSurfaceIndex(index);
  }

  function handleSurfaceDrop(event: DragEvent<HTMLElement>, kind: ExplicitSurfaceKindLiteral) {
    event.preventDefault();
    const rawIndex = event.dataTransfer.getData("text/plain");
    const transferred = rawIndex === "" ? Number.NaN : Number(rawIndex);
    const index = Number.isInteger(transferred) ? transferred : draggedSurfaceIndex;
    if (index !== null) moveSurface(index, kind);
    setDraggedSurfaceIndex(null);
    setDragOverSurfaceKind(null);
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
        body: JSON.stringify({ slug: slugDraft, expectedRevision: initial?.expectedRevision }),
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
      router.replace(`/edit/${encodeURIComponent(nextSlug)}`);
      router.refresh();
    } catch {
      setSlugError("네트워크 오류로 URL 주소를 변경하지 못했습니다.");
    } finally {
      setRenamingSlug(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // R108: 방어선 두 번째 겹. 버튼이 이미 링크로 바뀐 뒤라도 Enter 키 등으로
    // submit 이벤트가 다시 뜰 수 있는 경로를 여기서도 막는다.
    if (locked) return;
    if (imageUploading) return;

    setSaving(true);
    setErrorMessage(null);
    setIssues(null);
    setFieldErrors(null);
    setConflict(null);

    const payload = buildTermPayload(formWithPendingSurfaces, initial?.expectedRevision);
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
      if (outcome.warnings.length > 0) {
        // R108: 동음이의어 경고가 있으면 곧장 상세 화면으로 넘어가지 않는다.
        // 계획서 스케치는 여기서도 무조건 router.push했는데, 그러면 경고를 볼
        // 새도 없이 화면이 넘어가고, 사용자가 "저장이 안 된 줄 알고" 뒤로가기
        // 후 다시 제출하면 createTerm이 한 번 더 실행되어 완전히 새로운 중복
        // 용어가 생긴다(실측 재현 — 아래 보고 참고).
        setWarnings(outcome.warnings);
        setSavedSlug(outcome.term.slug);
      } else {
        router.push(`/w/${outcome.term.slug}`);
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

  return (
    <form onSubmit={onSubmit} className="w-full space-y-5">
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

      {savedSlug && warnings.length > 0 && (
        <div className="note note-warn" aria-live="polite">
          <p className="mb-1 font-medium">저장했습니다. 다만 같은 표기의 다른 용어가 있습니다</p>
          <ul className="space-y-0.5">
            {warnings.map((w) => (
              <li key={`${w.surfaceText}:${w.conflictingSlug}`}>
                {w.surfaceText} →{" "}
                <Link href={`/w/${w.conflictingSlug}`} className="underline underline-offset-2">
                  {w.conflictingSlug}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="card overflow-hidden">
          <CompactSectionTitle title="이름과 표기" description="대표 이름과 함께 검색할 약어·별칭을 한곳에서 관리합니다." />
          <div className="space-y-5 p-4 sm:p-5">
            <fieldset>
              <legend className="label">Type</legend>
              <p className="mb-2 text-xs leading-5 text-ink-3">항목 자체의 성격을 고릅니다. 약어와 풀네임은 아래 추가 표기에서 관리합니다.</p>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1 xl:grid-cols-4">
                {TERM_TYPES.map((type) => (
                  <label key={type} className="cursor-pointer">
                    <input
                      type="radio"
                      name="termType"
                      value={type}
                      checked={form.termType === type}
                      onChange={() => updateField("termType", type)}
                      disabled={locked}
                      className="peer sr-only"
                    />
                    <span className="flex min-h-9 items-center justify-center rounded-lg border border-transparent px-2 py-1.5 text-center text-xs text-ink-2 transition-[background-color,border-color,color,box-shadow] hover:bg-panel hover:text-ink peer-checked:border-line-strong peer-checked:bg-panel peer-checked:font-semibold peer-checked:text-brand peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                      {TERM_TYPE_LABEL[type]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <FormTextField
                name="nameEn"
                label={labels.nameEn}
                value={form.nameEn}
                errors={errorsFor("nameEn")}
                maxLength={TERM_NAME_MAX}
                disabled={locked}
                onChange={(value) => updateField("nameEn", value)}
              />
              <FormTextField
                name="nameKo"
                label={labels.nameKo}
                value={form.nameKo}
                errors={errorsFor("nameKo")}
                maxLength={TERM_NAME_MAX}
                disabled={locked}
                onChange={(value) => updateField("nameKo", value)}
              />

              {(labels.showFullNames || form.fullNameEn || form.fullNameKo) && (
                <>
                  <FormTextField
                    name="fullNameEn"
                    label={labels.fullNameEn}
                    value={form.fullNameEn}
                    errors={errorsFor("fullNameEn")}
                    maxLength={TERM_NAME_MAX}
                    disabled={locked}
                    onChange={(value) => updateField("fullNameEn", value)}
                  />
                  <FormTextField
                    name="fullNameKo"
                    label={labels.fullNameKo}
                    value={form.fullNameKo}
                    errors={errorsFor("fullNameKo")}
                    maxLength={TERM_NAME_MAX}
                    disabled={locked}
                    onChange={(value) => updateField("fullNameKo", value)}
                  />
                </>
              )}
              <p className="text-xs leading-5 text-ink-3 sm:col-span-2">{labels.primaryHint}</p>
            </div>

            <div className="border-t border-line pt-4">
              <div className="mb-3">
                <h3 className="text-sm font-medium text-ink">추가 표기 <span className="font-normal text-ink-3">{form.surfaces.length}개</span></h3>
                <p className="mt-0.5 text-xs leading-5 text-ink-3">먼저 여러 표기를 등록하고, 사용 중인 종류 사이로 끌어 분류하세요.</p>
              </div>

              <div className="rounded-xl border border-line bg-panel-2/50 p-3">
                <label htmlFor="surface-batch" className="label">표기 빠른 추가</label>
                <textarea
                  id="surface-batch"
                  name="surfaceBatch"
                  autoComplete="off"
                  value={surfaceBatch}
                  rows={2}
                  maxLength={TERM_NAME_MAX * 10}
                  disabled={locked}
                  placeholder="예: T/O, TO 또는 줄바꿈으로 입력…"
                  onChange={(event) => setSurfaceBatch(event.target.value)}
                  onKeyDown={handleSurfaceBatchKeyDown}
                  className="field resize-y"
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[6rem_minmax(7rem,1fr)_auto]">
                  <label className="block min-w-0">
                    <span className="sr-only">추가할 표기의 언어</span>
                    <select
                      name="surfaceBatchLang"
                      value={surfaceBatchLang}
                      disabled={locked}
                      aria-label="추가할 표기의 언어"
                      onChange={(event) => setSurfaceBatchLang(event.target.value as SurfaceLangLiteral)}
                      className="field py-1.5"
                    >
                      {SURFACE_LANGS.map((lang) => <option key={lang} value={lang}>{LANG_LABEL[lang]}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className="sr-only">추가할 표기의 종류</span>
                    <select
                      name="surfaceBatchKind"
                      value={surfaceBatchKind}
                      disabled={locked}
                      aria-label="추가할 표기의 종류"
                      onChange={(event) => setSurfaceBatchKind(event.target.value as ExplicitSurfaceKindLiteral)}
                      className="field py-1.5"
                    >
                      {EXPLICIT_SURFACE_KINDS.map((kind) => <option key={kind} value={kind}>{SURFACE_KIND_LABEL[kind]}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={addSurfaceBatch}
                    disabled={locked || pendingSurfaceValues.length === 0}
                    className="btn-primary btn-sm col-span-2 touch-manipulation sm:col-span-1"
                  >
                    <IconPlus />표기 추가
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-3">쉼표·줄바꿈으로 구분 · Enter로 추가 · Shift+Enter로 줄바꿈</p>
              </div>

              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-ink-2">표기 종류</h4>
                  <p className="mt-0.5 text-[11px] leading-5 text-ink-3">현재 등록된 종류만 표시합니다. 점 손잡이를 끌거나 각 항목의 종류를 선택하세요.</p>
                </div>
              </div>

              {usedSurfaceKinds.length > 0 ? (
                <div className="mt-2 grid items-start gap-3 sm:grid-cols-2">
                  {usedSurfaceKinds.map((kind) => {
                    const entries = form.surfaces
                      .map((surface, index) => ({ surface, index }))
                      .filter(({ surface }) => surface.kind === kind);
                    const isDragTarget = draggedSurfaceIndex !== null && dragOverSurfaceKind === kind;

                    return (
                      <section
                        key={kind}
                        aria-label={`${SURFACE_KIND_LABEL[kind]} 표기 ${entries.length}개`}
                        onDragOver={(event) => {
                          if (locked || draggedSurfaceIndex === null) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverSurfaceKind(kind);
                        }}
                        onDrop={(event) => handleSurfaceDrop(event, kind)}
                        className={`min-w-0 rounded-xl border p-2.5 transition-[border-color,background-color,box-shadow] ${
                          isDragTarget ? "border-brand bg-brand-soft ring-2 ring-brand/20" : "border-line bg-panel-2/35"
                        }`}
                      >
                        <header className="mb-2 flex items-center justify-between gap-2 px-1">
                          <h5 className="min-w-0 truncate text-xs font-semibold text-ink">{SURFACE_KIND_LABEL[kind]}</h5>
                          <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10px] tabular-nums text-ink-3">{entries.length}</span>
                        </header>
                        <div className="space-y-2">
                          {entries.map(({ surface, index }) => (
                            <div
                              key={index}
                              inert={draggedSurfaceIndex === index ? true : undefined}
                              className={`grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 rounded-lg border border-line bg-panel p-2 shadow-sm ${
                                draggedSurfaceIndex === index ? "select-none opacity-50" : ""
                              }`}
                            >
                              <span
                                draggable={!locked}
                                aria-hidden="true"
                                title="드래그해서 종류 변경"
                                onDragStart={(event) => handleSurfaceDragStart(event, index)}
                                onDragEnd={() => {
                                  setDraggedSurfaceIndex(null);
                                  setDragOverSurfaceKind(null);
                                }}
                                className="row-span-2 flex cursor-grab touch-none select-none items-center justify-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink active:cursor-grabbing"
                              >
                                <IconDragHandle />
                              </span>
                              <input
                                name={`surface-${index}-text`}
                                autoComplete="off"
                                aria-label={`추가 표기 ${index + 1}`}
                                value={surface.text}
                                maxLength={TERM_NAME_MAX}
                                onChange={(event) => updateSurface(index, { text: event.target.value })}
                                disabled={locked}
                                placeholder="예: T/O…"
                                className="field min-w-0 py-1.5"
                              />
                              <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(4.5rem,0.8fr)_minmax(5.5rem,1fr)_2.25rem] gap-1.5">
                                <select
                                  name={`surface-${index}-lang`}
                                  aria-label={`${surface.text || `추가 표기 ${index + 1}`} 언어`}
                                  value={surface.lang}
                                  onChange={(event) => updateSurface(index, { lang: event.target.value })}
                                  disabled={locked}
                                  className="field min-w-0 px-2 py-1.5 text-xs"
                                >
                                  {SURFACE_LANGS.map((lang) => <option key={lang} value={lang}>{LANG_LABEL[lang]}</option>)}
                                </select>
                                <select
                                  name={`surface-${index}-kind`}
                                  aria-label={`${surface.text || `추가 표기 ${index + 1}`} 종류`}
                                  value={surface.kind}
                                  onChange={(event) => moveSurface(index, event.target.value as ExplicitSurfaceKindLiteral)}
                                  disabled={locked}
                                  className="field min-w-0 px-2 py-1.5 text-xs"
                                >
                                  {EXPLICIT_SURFACE_KINDS.map((option) => <option key={option} value={option}>{SURFACE_KIND_LABEL[option]}</option>)}
                                </select>
                                <button
                                  type="button"
                                  aria-label={`${surface.text || `추가 표기 ${index + 1}`} 삭제`}
                                  title="표기 삭제"
                                  onClick={() => removeSurface(index)}
                                  disabled={locked}
                                  className="btn-quiet btn-sm h-9 w-9 touch-manipulation px-0 text-ink-3 hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/40"
                                >
                                  <IconTrash />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed border-line px-3 py-5 text-center">
                  <p className="text-xs text-ink-3">위 입력창에서 표기를 추가하면 종류별로 묶어 보여줍니다.</p>
                </div>
              )}
              <p className="sr-only" aria-live="polite">
                {surfaceAnnouncement}
              </p>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden lg:sticky lg:top-16">
          <CompactSectionTitle title="관리 정보" description="검색 노출과 관리 책임을 정합니다." />
          <div className="space-y-4 p-4">
            <label className="block">
              <span className="label">공개 상태</span>
              <select
                name="status"
                value={form.status}
                onChange={(event) => updateField("status", event.target.value as TermStatusLiteral)}
                disabled={locked}
                aria-invalid={errorsFor("status") ? true : undefined}
                aria-describedby={errorsFor("status") ? "status-error" : "status-hint"}
                className="field"
              >
                {TERM_STATUSES.map((status) => <option key={status} value={status}>{TERM_STATUS_LABEL[status]}</option>)}
              </select>
              <span id="status-hint" className="mt-1.5 block text-xs leading-5 text-ink-3">{TERM_STATUS_HINT[form.status]}</span>
              <FormFieldError id="status-error" errors={errorsFor("status")} />
            </label>

            <FormTextField
              name="domain"
              label="도메인"
              value={form.domain}
              errors={errorsFor("domain")}
              maxLength={TERM_DOMAIN_TEXT_MAX}
              disabled={locked}
              placeholder="예: ISP, PM…"
              hint="여러 값은 쉼표로 구분합니다."
              onChange={(value) => updateField("domain", value)}
            />
            <label className="block">
              <span className="label">업무 분류</span>
              <select
                name="category"
                value={form.category}
                onChange={(event) => updateField("category", event.target.value)}
                disabled={locked}
                aria-invalid={errorsFor("category") ? true : undefined}
                aria-describedby={errorsFor("category") ? "category-error" : "category-hint"}
                className="field"
              >
                <option value="">미분류</option>
                {categoryOptions.map((category) => (
                  <option key={category.key} value={category.key}>{category.label}</option>
                ))}
              </select>
              <span id="category-hint" className="mt-1.5 block text-xs leading-5 text-ink-3">제품·프로젝트·설계처럼 이 항목이 속한 주된 업무 맥락입니다.</span>
              <FormFieldError id="category-error" errors={errorsFor("category")} />
            </label>
            <FormTextField
              name="topic"
              label="주제"
              value={form.topic}
              errors={errorsFor("topic")}
              maxLength={TERM_NAME_MAX}
              disabled={locked}
              placeholder="예: 노출 제어…"
              hint="기존 자유 입력 카테고리는 주제로 보존됩니다."
              onChange={(value) => updateField("topic", value)}
            />

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

            {editSlug !== undefined && (
              <div className="border-t border-line pt-4">
                <label htmlFor="term-slug" className="label">URL 주소</label>
                <div className="flex overflow-hidden rounded-lg border border-line bg-panel focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                  <span className="flex shrink-0 items-center border-r border-line bg-panel-2 px-2.5 text-xs text-ink-3">/w/</span>
                  <input
                    id="term-slug"
                    name="slug"
                    autoComplete="off"
                    value={slugDraft}
                    maxLength={TERM_SLUG_MAX}
                    disabled={locked}
                    aria-invalid={slugError ? true : undefined}
                    aria-describedby="term-slug-hint term-slug-error"
                    onChange={(event) => {
                      setSlugDraft(event.target.value);
                      setSlugError(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <p id="term-slug-hint" className="mt-1.5 text-xs leading-5 text-ink-3">
                  {dirty
                    ? "다른 변경사항을 먼저 저장해야 URL을 변경할 수 있습니다."
                    : normalizedSlug && normalizedSlug !== slugDraft
                      ? `실제 주소: /w/${normalizedSlug}`
                      : "글자·숫자와 하이픈으로 정리되어 저장됩니다."}
                </p>
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
            )}
          </div>
        </section>
      </div>

      <section className="card p-4 sm:p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-ink">정의</h2>
          <p className="mt-0.5 text-xs text-ink-3">검색 결과에서 먼저 읽히는 짧은 설명입니다.</p>
        </div>
        <textarea
          name="definitionMd"
          autoComplete="off"
          value={form.definitionMd}
          maxLength={TERM_MARKDOWN_MAX}
          onChange={(event) => updateField("definitionMd", event.target.value)}
          disabled={locked}
          aria-label="정의"
          aria-invalid={errorsFor("definitionMd") ? true : undefined}
          aria-describedby={errorsFor("definitionMd") ? "definitionMd-error" : undefined}
          rows={3}
          placeholder="한두 문장으로 이 용어가 무엇인지…"
          className="field"
        />
        <FormFieldError id="definitionMd-error" errors={errorsFor("definitionMd")} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-ink">본문</h2>
          <p className="mt-0.5 text-xs text-ink-3">예시나 배경처럼 정의만으로 부족한 맥락을 남깁니다.</p>
        </div>
        <MarkdownEditor
          label="용어 본문"
          describedBy={errorsFor("bodyMd") ? "bodyMd-error" : undefined}
          invalid={Boolean(errorsFor("bodyMd"))}
          value={form.bodyMd}
          maxLength={TERM_MARKDOWN_MAX}
          onChange={(bodyMd) => updateField("bodyMd", bodyMd)}
          disabled={locked}
          onUploadingChange={setImageUploading}
        />
        <FormFieldError id="bodyMd-error" errors={errorsFor("bodyMd")} />
      </section>

      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2.5 shadow-lg backdrop-blur">
        <p className="min-w-0 truncate text-xs text-ink-3" aria-live="polite">
          {savedSlug ? "저장 완료" : editSlug === undefined ? "새 용어 작성 중" : dirty ? "저장하지 않은 변경사항이 있습니다" : "변경사항 없음"}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link href={editSlug !== undefined ? `/w/${editSlug}` : "/sheet"} className="btn-quiet">
            취소
          </Link>
          {savedSlug ? (
            <Link href={`/w/${savedSlug}`} className="btn-primary">
              저장됨 → {savedSlug}로 이동
            </Link>
          ) : (
            <button type="submit" disabled={saving || imageUploading} className="btn-primary">
              {imageUploading ? "이미지 변환 중…" : saving ? "저장 중…" : editSlug === undefined ? "용어 저장" : "변경사항 저장"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function CompactSectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="border-b border-line bg-panel-2/50 px-4 py-3 sm:px-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs leading-5 text-ink-3">{description}</p>
    </header>
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
  onChange: (value: string) => void;
}) {
  const errorId = `${name}-error`;
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input
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
      {hint && !errors && <span className="mt-1.5 block text-xs leading-5 text-ink-3">{hint}</span>}
      <FormFieldError id={errorId} errors={errors} />
    </label>
  );
}

function FormFieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return (
    <span id={id} className="mt-1.5 block text-xs leading-5 text-danger">
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

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3.5 5h9M6 5V3.5h4V5m-5.5 0 .6 8h5.8l.6-8M6.8 7.3v3.5M9.2 7.3v3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDragHandle() {
  return (
    <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="4" r="1.1" />
      <circle cx="9" cy="4" r="1.1" />
      <circle cx="3" cy="9" r="1.1" />
      <circle cx="9" cy="9" r="1.1" />
      <circle cx="3" cy="14" r="1.1" />
      <circle cx="9" cy="14" r="1.1" />
    </svg>
  );
}
