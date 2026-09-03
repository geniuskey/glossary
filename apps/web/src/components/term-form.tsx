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
  type MouseEvent as ReactMouseEvent,
} from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { HelpTip } from "@/components/help-tip";
import { ClassificationMultiSelect } from "@/components/classification-multi-select";
import {
  EXPLICIT_SURFACE_KINDS,
  SURFACE_KIND_LABEL,
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
import { inferSurfaceLang } from "@/lib/terms/surface-language";
import { cx } from "@/lib/ui/format";
import {
  TERM_QUALITY_PROFILES,
  TERM_QUALITY_PROFILE_DESCRIPTION,
  TERM_QUALITY_PROFILE_LABEL,
  type TermQualityProfile,
} from "@/lib/workspace/term-quality-values";

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

const SURFACE_LANGUAGE_STYLE: Record<SurfaceLangLiteral, string> = {
  ko: "border-brand/40 bg-brand-soft text-brand",
  en: "border-info/40 bg-info-soft text-info",
  neutral: "border-warn/40 bg-warn-soft text-warn",
};
const SURFACE_LANGUAGE_ORDER = ["ko", "en", "neutral"] as const;

const QUALITY_PROFILE_HINT: Record<TermQualityProfile, string> = {
  auto: "약어·식별자·단위에 Full name이 있으면 표기 매핑으로, 나머지는 맥락 설명으로 판단합니다. 폐기·금지 용어는 사용 지침을 적용합니다.",
  mapping: TERM_QUALITY_PROFILE_DESCRIPTION.mapping,
  context: TERM_QUALITY_PROFILE_DESCRIPTION.context,
  guidance: TERM_QUALITY_PROFILE_DESCRIPTION.guidance,
};

function commaSeparatedValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function surfaceLangLabel(lang: string): string {
  return LANG_LABEL[lang as SurfaceLangLiteral] ?? lang;
}

const EMPTY: TermFormState = {
  termType: "concept",
  qualityProfile: "auto",
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
  domainOptions = [],
  categoryOptions = [],
  canDelete = false,
}: {
  initial?: TermFormInitial;
  assignees?: AssignableUser[];
  domainOptions?: string[];
  categoryOptions?: BusinessCategoryOption[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  const editSlug = initial?.slug;
  const compact = editSlug !== undefined;

  const [form, setForm] = useState<TermFormState>(() => {
    const source = initial ?? EMPTY;
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
  const [surfaceBatchKind, setSurfaceBatchKind] = useState<ExplicitSurfaceKindLiteral>("alias");
  const [draggedSurfaceIndex, setDraggedSurfaceIndex] = useState<number | null>(null);
  const [dragOverSurfaceKind, setDragOverSurfaceKind] = useState<ExplicitSurfaceKindLiteral | null>(null);
  const [surfaceMenu, setSurfaceMenu] = useState<{ index: number; x: number; y: number } | null>(null);
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
  const surfaceMenuRef = useRef<HTMLDivElement>(null);
  // dragover는 dragstart 직후 React 상태가 반영되기 전에도 발생할 수 있으므로
  // 드롭 허용 여부와 원본 인덱스는 동기적으로 갱신되는 ref를 기준으로 삼는다.
  const draggedSurfaceIndexRef = useRef<number | null>(null);
  const initialSnapshotRef = useRef(JSON.stringify(buildTermPayload(initial ?? EMPTY)));

  const locked = saving || deleting || renamingSlug || savedSlug !== null;
  const labels = TERM_FIELD_LABELS[form.termType as TermTypeLiteral] ?? TERM_FIELD_LABELS.concept;
  const fieldDisplayLabel: Record<string, string> = {
    termType: "용어 종류",
    qualityProfile: "AI 활용 기준",
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
      ...pendingSurfaceValues.map((text) => ({ text, lang: inferSurfaceLang(text), kind: surfaceBatchKind })),
    ],
  }), [form, pendingSurfaceValues, surfaceBatchKind]);
  const formSnapshot = useMemo(() => JSON.stringify(buildTermPayload(formWithPendingSurfaces)), [formWithPendingSurfaces]);
  const dirty = formSnapshot !== initialSnapshotRef.current;
  const normalizedSlug = slugify(slugDraft);
  const slugChanged = editSlug !== undefined && normalizedSlug !== editSlug;
  const slugDraftIssue = slugValidationMessage(normalizedSlug);
  const menuSurface = surfaceMenu ? form.surfaces[surfaceMenu.index] : undefined;

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

  useEffect(() => {
    if (!surfaceMenu) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (surfaceMenuRef.current?.contains(event.target as Node)) return;
      setSurfaceMenu(null);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSurfaceMenu(null);
    };
    const closeFromViewport = () => setSurfaceMenu(null);
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", closeFromViewport);
    window.addEventListener("scroll", closeFromViewport, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", closeFromViewport);
      window.removeEventListener("scroll", closeFromViewport, true);
    };
  }, [surfaceMenu]);

  function updateField<K extends keyof TermFormState>(key: K, value: TermFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateSurface(index: number, patch: Partial<SurfaceDraft>) {
    setForm((f) => ({
      ...f,
      surfaces: f.surfaces.map((surface, i) => {
        if (i !== index) return surface;
        const next = { ...surface, ...patch };
        return { ...next, lang: inferSurfaceLang(next.text) };
      }),
    }));
  }

  function addSurfaceBatch() {
    const values = pendingSurfaceValues;
    if (values.length === 0 || locked) return;

    setForm((current) => ({
      ...current,
      surfaces: [
        ...current.surfaces,
        ...values.map((text) => ({ text, lang: inferSurfaceLang(text), kind: surfaceBatchKind })),
      ],
    }));
    setSurfaceBatch("");
    setSurfaceAnnouncement(`${SURFACE_KIND_LABEL[surfaceBatchKind]}에 표기 ${values.length}개를 추가했습니다.`);
  }

  function removeSurface(index: number) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.filter((_, i) => i !== index) }));
    setSurfaceMenu(null);
  }

  function moveSurface(index: number, kind: ExplicitSurfaceKindLiteral) {
    const surface = form.surfaces[index];
    if (!surface || surface.kind === kind) return;
    updateSurface(index, { kind });
    setSurfaceAnnouncement(`${surface.text || `추가 표기 ${index + 1}`}을(를) ${SURFACE_KIND_LABEL[kind]}으로 이동했습니다.`);
  }

  function handleSurfaceBatchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
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
    event.dataTransfer.setData("application/x-grossary-surface-index", String(index));
    draggedSurfaceIndexRef.current = index;
    setSurfaceMenu(null);
    setDraggedSurfaceIndex(index);
  }

  function openSurfaceMenu(index: number, x: number, y: number) {
    if (locked) return;
    setSurfaceMenu({
      index,
      x: Math.max(8, Math.min(x, window.innerWidth - 232)),
      y: Math.max(8, Math.min(y, window.innerHeight - 360)),
    });
  }

  function handleSurfaceContextMenu(event: ReactMouseEvent<HTMLElement>, index: number) {
    event.preventDefault();
    openSurfaceMenu(index, event.clientX, event.clientY);
  }

  function handleSurfaceBadgeKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || event.key === "Enter" || event.key === " ")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openSurfaceMenu(index, rect.left + Math.min(rect.width, 120), rect.bottom + 4);
  }

  function handleSurfaceDrop(event: DragEvent<HTMLElement>, kind: ExplicitSurfaceKindLiteral) {
    event.preventDefault();
    event.stopPropagation();
    const rawIndex = event.dataTransfer.getData("application/x-grossary-surface-index") || event.dataTransfer.getData("text/plain");
    const transferred = rawIndex === "" ? Number.NaN : Number(rawIndex);
    const index = Number.isInteger(transferred) ? transferred : draggedSurfaceIndexRef.current;
    if (index !== null) moveSurface(index, kind);
    draggedSurfaceIndexRef.current = null;
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
    <form onSubmit={onSubmit} className={cx("w-full", compact ? "space-y-3" : "space-y-5")}>
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

      <div className={cx("grid items-start lg:grid-cols-[minmax(0,1fr)_18rem]", compact ? "gap-3" : "gap-4")}>
        <section className="card">
          <CompactSectionTitle compact={compact} title="이름과 표기" description="대표 이름과 함께 검색할 약어·별칭을 한곳에서 관리합니다." />
          <div className={compact ? "space-y-3 p-3" : "space-y-5 p-4 sm:p-5"}>
            <fieldset>
              <legend className="label">
                <span className="inline-flex items-center gap-1.5">Type <HelpTip text="항목 자체의 성격을 고릅니다. 약어와 풀네임은 아래 추가 표기에서 관리합니다." /></span>
              </legend>
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
                    <span className={cx("flex items-center justify-center rounded-lg border border-transparent px-2 text-center text-xs text-ink-2 transition-[background-color,border-color,color,box-shadow] hover:bg-panel hover:text-ink peer-checked:border-line-strong peer-checked:bg-panel peer-checked:font-semibold peer-checked:text-brand peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50", compact ? "min-h-8 py-1" : "min-h-9 py-1.5")}>
                      {TERM_TYPE_LABEL[type]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={cx("grid border-t border-line sm:grid-cols-2", compact ? "gap-2 pt-3" : "gap-3 pt-4")}>
              <FormTextField
                name="nameEn"
                label={labels.nameEn}
                hint={labels.primaryHint}
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
            </div>

            <div className={cx("border-t border-line", compact ? "pt-3" : "pt-4")}>
              <div className={cx("flex items-center gap-1.5", compact ? "mb-2" : "mb-3")}>
                <h3 className="text-sm font-medium text-ink">추가 표기 <span className="font-normal text-ink-3">{form.surfaces.length}개</span></h3>
                <HelpTip text="먼저 여러 표기를 등록하고, 사용 중인 종류 사이로 끌어 분류하세요." />
              </div>

              <div className="rounded-xl border border-line bg-panel-2/50 p-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <label htmlFor="surface-batch" className="text-xs font-medium text-ink-2">표기 빠른 추가</label>
                    <HelpTip text="쉼표로 여러 표기를 구분하고 Enter로 추가할 수 있습니다." />
                  </span>
                <input
                  id="surface-batch"
                  name="surfaceBatch"
                  autoComplete="off"
                  value={surfaceBatch}
                  maxLength={TERM_NAME_MAX * 10}
                  disabled={locked}
                  placeholder="예: T/O, TO, 티오…"
                  onChange={(event) => setSurfaceBatch(event.target.value)}
                  onKeyDown={handleSurfaceBatchKeyDown}
                  className="field h-8 min-w-0 flex-1 py-0"
                />
                  <select
                    name="surfaceBatchKind"
                    value={surfaceBatchKind}
                    disabled={locked}
                    aria-label="추가할 표기의 종류"
                    onChange={(event) => setSurfaceBatchKind(event.target.value as ExplicitSurfaceKindLiteral)}
                    className="field h-8 py-0 sm:w-32"
                  >
                    {EXPLICIT_SURFACE_KINDS.map((kind) => <option key={kind} value={kind}>{SURFACE_KIND_LABEL[kind]}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={addSurfaceBatch}
                    disabled={locked || pendingSurfaceValues.length === 0}
                    className="btn-primary btn-sm h-8 shrink-0 touch-manipulation"
                  >
                    <IconPlus />표기 추가
                  </button>
                </div>
              </div>

              <div className={cx("flex items-start justify-between gap-3", compact ? "mt-3" : "mt-4")}>
                <div className="inline-flex items-center gap-1.5">
                  <h4 className="text-xs font-semibold text-ink-2">표기 종류</h4>
                  <HelpTip text="배지 전체를 끌어 종류를 바꾸고, 우클릭해서 표기 옵션을 수정하세요." />
                </div>
                <div className="flex shrink-0 items-center gap-2.5 text-[10px] text-ink-3" aria-label="표기 언어 색상">
                  {SURFACE_LANGUAGE_ORDER.map((lang) => (
                    <span key={lang} className="inline-flex items-center gap-1">
                      <span className={cx("h-2 w-2 rounded-full border", SURFACE_LANGUAGE_STYLE[lang])} aria-hidden="true" />
                      {LANG_LABEL[lang]}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-line-strong bg-panel-2/30 p-2 shadow-inner">
                <div className="flex flex-wrap items-stretch gap-1.5">
                  {EXPLICIT_SURFACE_KINDS.map((kind) => {
                    const entries = form.surfaces
                      .map((surface, index) => ({ surface, index }))
                      .filter(({ surface }) => surface.kind === kind);
                    const isDragTarget = draggedSurfaceIndex !== null && dragOverSurfaceKind === kind;

                    return (
                      <section
                        key={kind}
                        aria-label={`${SURFACE_KIND_LABEL[kind]} 표기 ${entries.length}개`}
                        onDragOver={(event) => {
                          if (locked || draggedSurfaceIndexRef.current === null) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverSurfaceKind(kind);
                        }}
                        onDrop={(event) => handleSurfaceDrop(event, kind)}
                        className={`w-max min-w-28 max-w-80 flex-none rounded-lg border border-dashed p-1.5 transition-[width,border-color,background-color,box-shadow] ${
                          isDragTarget ? "border-brand bg-brand-soft ring-2 ring-brand/20" : "border-line-strong bg-panel/70"
                        }`}
                      >
                        <header className="mb-1 flex items-center justify-between gap-1">
                          <h5 className="min-w-0 truncate text-xs font-semibold text-ink">{SURFACE_KIND_LABEL[kind]}</h5>
                          <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] tabular-nums text-ink-3">{entries.length}</span>
                        </header>
                        <div className="flex flex-wrap gap-1.5">
                          {entries.map(({ surface, index }) => {
                            const language = inferSurfaceLang(surface.text);
                            return (
                            <div
                              key={index}
                              tabIndex={locked ? -1 : 0}
                              aria-haspopup="menu"
                              aria-label={`${surface.text || `추가 표기 ${index + 1}`} · ${surfaceLangLabel(inferSurfaceLang(surface.text))} · 우클릭하여 옵션 열기`}
                              title="드래그로 이동 · 우클릭으로 옵션 열기"
                              draggable={!locked}
                              onContextMenu={(event) => handleSurfaceContextMenu(event, index)}
                              onKeyDown={(event) => handleSurfaceBadgeKeyDown(event, index)}
                              onDragStart={(event) => handleSurfaceDragStart(event, index)}
                              onDragEnd={() => {
                                draggedSurfaceIndexRef.current = null;
                                setDraggedSurfaceIndex(null);
                                setDragOverSurfaceKind(null);
                              }}
                              className={`group inline-flex max-w-full cursor-grab touch-none select-none items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs shadow-sm transition hover:brightness-[0.97] hover:shadow active:cursor-grabbing ${SURFACE_LANGUAGE_STYLE[language]} ${
                                draggedSurfaceIndex === index ? "select-none opacity-50" : ""
                              }`}
                            >
                              <span className="truncate font-medium">{surface.text || "이름 없음"}</span>
                              <button
                                type="button"
                                draggable={false}
                                aria-label={`${surface.text || `추가 표기 ${index + 1}`} 삭제`}
                                title="표기 삭제"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeSurface(index);
                                }}
                                disabled={locked}
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sm leading-none text-ink-3 opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100"
                              >
                                ×
                              </button>
                            </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
              {surfaceMenu && menuSurface && (
                <div
                  ref={surfaceMenuRef}
                  role="menu"
                  aria-label={`${menuSurface.text || "추가 표기"} 옵션`}
                  className="fixed z-50 w-56 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl"
                  style={{ left: surfaceMenu.x, top: surfaceMenu.y }}
                >
                  <div className="border-b border-line bg-panel-2/70 p-2.5">
                    <label className="label" htmlFor="surface-menu-text">표기</label>
                    <input
                      id="surface-menu-text"
                      name={`surface-${surfaceMenu.index}-text`}
                      autoComplete="off"
                      value={menuSurface.text}
                      maxLength={TERM_NAME_MAX}
                      onChange={(event) => updateSurface(surfaceMenu.index, { text: event.target.value })}
                      className="field py-1.5"
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="mb-1.5 text-[11px] font-semibold text-ink-3">표기 종류</p>
                    <div className="grid grid-cols-2 gap-1">
                      {EXPLICIT_SURFACE_KINDS.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          role="menuitemradio"
                          aria-checked={menuSurface.kind === kind}
                          onClick={() => moveSurface(surfaceMenu.index, kind)}
                          className={cx("btn-sm justify-start rounded-md", menuSurface.kind === kind ? "btn-primary" : "btn-quiet")}
                        >
                          {SURFACE_KIND_LABEL[kind]}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => removeSurface(surfaceMenu.index)}
                      className="btn-danger btn-sm mt-3 w-full"
                    >
                      이 표기 삭제
                    </button>
                  </div>
                </div>
              )}
              <p className="sr-only" aria-live="polite">
                {surfaceAnnouncement}
              </p>
            </div>
          </div>
        </section>

        <section className="card lg:sticky lg:top-16">
          <CompactSectionTitle compact={compact} title="관리 정보" description="검색 노출과 관리 책임을 정합니다." />
          <div className={compact ? "space-y-3 p-3" : "space-y-4 p-4"}>
            <div className="block">
              <span className="label inline-flex items-center gap-1.5"><label htmlFor="term-status">공개 상태</label> <HelpTip text={TERM_STATUS_HINT[form.status]} /></span>
              <select
                id="term-status"
                name="status"
                value={form.status}
                onChange={(event) => updateField("status", event.target.value as TermStatusLiteral)}
                disabled={locked}
                aria-invalid={errorsFor("status") ? true : undefined}
                aria-describedby={errorsFor("status") ? "status-error" : undefined}
                className="field"
              >
                {TERM_STATUSES.map((status) => <option key={status} value={status}>{TERM_STATUS_LABEL[status]}</option>)}
              </select>
              <FormFieldError id="status-error" errors={errorsFor("status")} />
            </div>

            <div className="block">
              <span className="label inline-flex items-center gap-1.5">
                <label htmlFor="term-quality-profile">AI 활용 기준</label>
                <HelpTip text={QUALITY_PROFILE_HINT[form.qualityProfile]} />
              </span>
              <select
                id="term-quality-profile"
                name="qualityProfile"
                value={form.qualityProfile}
                onChange={(event) => updateField("qualityProfile", event.target.value as TermQualityProfile)}
                disabled={locked}
                aria-invalid={errorsFor("qualityProfile") ? true : undefined}
                aria-describedby={errorsFor("qualityProfile") ? "qualityProfile-error" : undefined}
                className="field"
              >
                {TERM_QUALITY_PROFILES.map((profile) => (
                  <option key={profile} value={profile}>{TERM_QUALITY_PROFILE_LABEL[profile]}</option>
                ))}
              </select>
              <FormFieldError id="qualityProfile-error" errors={errorsFor("qualityProfile")} />
            </div>

            <ClassificationMultiSelect
              name="domain"
              label="도메인"
              help="여러 도메인을 선택할 수 있습니다. 등록되지 않은 값은 분류 체계에서 먼저 추가합니다."
              placeholder="도메인 검색…"
              selected={commaSeparatedValues(form.domain)}
              initialOptions={domainOptions.map((domain) => ({ value: domain, label: domain }))}
              kind="domain"
              manageHref="/classifications"
              refresh={{ url: "/api/v1/admin/domains", responseKey: "domains" }}
              disabled={locked}
              invalid={Boolean(errorsFor("domain"))}
              describedBy={errorsFor("domain") ? "domain-error" : undefined}
              onChange={(values) => updateField("domain", values.join(", "))}
            />
            <FormFieldError id="domain-error" errors={errorsFor("domain")} />
            <ClassificationMultiSelect
              name="category"
              label="업무 분류"
              help="여러 업무 분류를 선택할 수 있습니다. 등록되지 않은 값은 분류 체계에서 먼저 추가합니다."
              placeholder="업무 분류 검색…"
              selected={commaSeparatedValues(form.category)}
              initialOptions={categoryOptions.map((category) => ({
                value: category.key,
                label: category.labelKo,
                secondaryLabel: category.labelEn,
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
              <details className="rounded-lg border border-line bg-panel-2/35">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-2">URL 주소 변경</summary>
                <div className="border-t border-line p-3">
                <span className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                  URL 주소
                  <HelpTip text={dirty ? "다른 변경사항을 먼저 저장해야 URL을 변경할 수 있습니다." : normalizedSlug && normalizedSlug !== slugDraft ? `실제 주소: /w/${normalizedSlug}` : "글자·숫자와 하이픈으로 정리되어 저장됩니다."} />
                </span>
                <label htmlFor="term-slug" className="sr-only">URL 주소</label>
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
          </div>
        </section>
      </div>

      <section className={cx("card", compact ? "p-3" : "p-4 sm:p-5")}>
        <div className={compact ? "mb-2 flex items-baseline gap-2" : "mb-3"}>
          <h2 className="text-sm font-semibold text-ink">정의</h2>
          <HelpTip text="검색 결과에서 먼저 읽히는 짧은 설명입니다." />
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
          rows={compact ? 2 : 3}
          placeholder="한두 문장으로 이 용어가 무엇인지…"
          className="field"
        />
        <FormFieldError id="definitionMd-error" errors={errorsFor("definitionMd")} />
      </section>

      <section>
        <div className={compact ? "mb-2 flex items-baseline gap-2" : "mb-3"}>
          <h2 className="text-sm font-semibold text-ink">본문</h2>
          <HelpTip text="예시나 배경처럼 정의만으로 부족한 맥락을 남깁니다." />
        </div>
        <MarkdownEditor
          label="용어 본문"
          describedBy={errorsFor("bodyMd") ? "bodyMd-error" : undefined}
          invalid={Boolean(errorsFor("bodyMd"))}
          value={form.bodyMd}
          maxLength={TERM_MARKDOWN_MAX}
          onChange={(bodyMd) => updateField("bodyMd", bodyMd)}
          disabled={locked}
          compact={compact}
          resizable={compact}
          onUploadingChange={setImageUploading}
        />
        <FormFieldError id="bodyMd-error" errors={errorsFor("bodyMd")} />
      </section>

      <div className={cx("sticky z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-3 shadow-lg backdrop-blur", compact ? "bottom-2 py-2" : "bottom-3 py-2.5")}>
        <p className="min-w-0 truncate text-xs text-ink-3" aria-live="polite">
          {deleting ? "삭제 중…" : savedSlug ? "저장 완료" : editSlug === undefined ? "새 용어 작성 중" : dirty ? "저장하지 않은 변경사항이 있습니다" : "변경사항 없음"}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {editSlug !== undefined && canDelete && (
            <button type="button" onClick={() => void deleteCurrentTerm()} disabled={locked} className="btn-danger">
              {deleting ? "삭제 중…" : "삭제"}
            </button>
          )}
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
  compact = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <header className={cx("rounded-t-xl border-b border-line bg-panel-2/50", compact ? "flex flex-wrap items-center gap-x-2 px-3 py-2" : "flex items-center gap-2 px-4 py-3 sm:px-5")}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <HelpTip text={description} />
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
