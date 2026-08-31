"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
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
  type SurfaceLangLiteral,
  type TermStatusLiteral,
  type TermTypeLiteral,
} from "@/lib/terms/enums";
import { TERM_FIELD_LABELS } from "@/lib/terms/form-labels";
import { buildTermPayload, type SurfaceDraft, type TermFormState } from "@/lib/terms/form-payload";
import { interpretResponse, type FormOutcome } from "@/lib/terms/form-response";
import { TERM_DOMAIN_TEXT_MAX, TERM_MARKDOWN_MAX, TERM_NAME_MAX } from "@/lib/terms/limits";
import type { AssignableUser } from "@/lib/terms/owners";

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

const STATUS_DOT: Record<TermStatusLiteral, string> = {
  draft: "bg-ink-3",
  active: "bg-ok",
  deprecated: "bg-warn",
  forbidden: "bg-danger",
};

const EMPTY: TermFormState = {
  termType: "term",
  nameEn: "",
  nameKo: "",
  fullNameEn: "",
  fullNameKo: "",
  domain: "",
  category: "",
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

export function TermForm({ initial, assignees = [] }: { initial?: TermFormInitial; assignees?: AssignableUser[] }) {
  const router = useRouter();
  const editSlug = initial?.slug;

  const [form, setForm] = useState<TermFormState>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
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

  const locked = saving || savedSlug !== null;
  const labels = TERM_FIELD_LABELS[form.termType as TermTypeLiteral] ?? TERM_FIELD_LABELS.term;

  function updateField<K extends keyof TermFormState>(key: K, value: TermFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateSurface(index: number, patch: Partial<SurfaceDraft>) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addSurface(kind: SurfaceDraft["kind"] = "alias") {
    setForm((f) => ({ ...f, surfaces: [...f.surfaces, { text: "", lang: "neutral", kind }] }));
  }

  function removeSurface(index: number) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.filter((_, i) => i !== index) }));
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

    const payload = buildTermPayload(form, initial?.expectedRevision);
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
        <div className="note note-danger" aria-live="polite">
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
                  {field}: {errs.join(", ")}
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

      <section className="card overflow-hidden">
        <FormSectionTitle icon={<IconIdentity />} title="기본 정보" description="어떤 이름을 어떻게 사용할지 정합니다." />
        <div className="space-y-6 p-4 sm:p-5">
          <fieldset>
            <legend className="label">용어 종류</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
                  <span className="flex min-h-10 items-center justify-center rounded-lg border border-line bg-panel px-2.5 py-2 text-center text-sm text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand-soft peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-medium peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                    {TERM_TYPE_LABEL[type]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <label className="block">
            <span className="label">{labels.nameEn}</span>
            <input
              name="nameEn"
              autoComplete="off"
              value={form.nameEn}
              maxLength={TERM_NAME_MAX}
              onChange={(e) => updateField("nameEn", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          <label className="block">
            <span className="label">{labels.nameKo}</span>
            <input
              name="nameKo"
              autoComplete="off"
              value={form.nameKo}
              maxLength={TERM_NAME_MAX}
              onChange={(e) => updateField("nameKo", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          {(labels.showFullNames || form.fullNameEn || form.fullNameKo) && (
            <>
              <label className="block">
                <span className="label">{labels.fullNameEn}</span>
                <input
                  name="fullNameEn"
                  autoComplete="off"
                  value={form.fullNameEn}
                  maxLength={TERM_NAME_MAX}
                  onChange={(e) => updateField("fullNameEn", e.target.value)}
                  disabled={locked}
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label">{labels.fullNameKo}</span>
                <input
                  name="fullNameKo"
                  autoComplete="off"
                  value={form.fullNameKo}
                  maxLength={TERM_NAME_MAX}
                  onChange={(e) => updateField("fullNameKo", e.target.value)}
                  disabled={locked}
                  className="field"
                />
              </label>
            </>
          )}

          <label className="block sm:col-span-2">
            <span className="label">도메인 (쉼표로 구분)</span>
            <input
              name="domain"
              autoComplete="off"
              value={form.domain}
              maxLength={TERM_DOMAIN_TEXT_MAX}
              onChange={(e) => updateField("domain", e.target.value)}
              disabled={locked}
              placeholder="예: ISP, PM…"
              className="field"
            />
          </label>

          <label className="block">
            <span className="label">카테고리</span>
            <input
              name="category"
              autoComplete="off"
              value={form.category}
              maxLength={TERM_NAME_MAX}
              onChange={(e) => updateField("category", e.target.value)}
              disabled={locked}
              placeholder="예: 공정, 결제, 사용자 인증…"
              className="field"
            />
            <span className="mt-1.5 block text-xs leading-5 text-ink-3">도메인 안에서 용어를 묶는 한 단계 좁은 분류입니다.</span>
          </label>

          <label className="block">
            <span className="label">담당자</span>
            <select
              name="ownerId"
              value={form.ownerId}
              onChange={(e) => updateField("ownerId", e.target.value)}
              disabled={locked}
              className="field"
            >
              <option value="">미지정 · 누구나 정리</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-xs leading-5 text-ink-3">완성을 책임질 사람을 정하되, 다른 사람도 계속 보탤 수 있습니다.</span>
          </label>
          </div>

          <fieldset className="border-t border-line pt-5">
            <legend className="label float-left w-full">공개 상태</legend>
            <div className="clear-both grid grid-cols-2 gap-2 lg:grid-cols-4">
              {TERM_STATUSES.map((status) => (
                <label key={status} className="cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    value={status}
                    checked={form.status === status}
                    onChange={() => updateField("status", status)}
                    disabled={locked}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-2 transition-colors hover:border-brand/40 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-medium peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
                    {TERM_STATUS_LABEL[status]}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-3">{TERM_STATUS_HINT[form.status]}</p>
          </fieldset>
        </div>
        <p className="border-t border-line bg-panel-2/50 px-4 py-3 text-xs text-ink-3 sm:px-5">{labels.primaryHint}</p>
      </section>

      <section className="card overflow-hidden">
        <FormSectionTitle icon={<IconDocument />} title="설명" description="짧은 정의를 먼저 쓰고, 필요한 맥락은 본문에 자세히 남깁니다." />
        <div className="space-y-5 p-4 sm:p-5">
        <label className="block">
          <span className="label">정의</span>
          <textarea
            name="definitionMd"
            autoComplete="off"
            value={form.definitionMd}
            maxLength={TERM_MARKDOWN_MAX}
            onChange={(e) => updateField("definitionMd", e.target.value)}
            disabled={locked}
            rows={3}
            placeholder="한두 문장으로 이 용어가 무엇인지…"
            className="field"
          />
        </label>

        {/* R111: bodyMd는 terms.body_md 컬럼에 이미 저장되고(lib/terms/create.ts,
            update.ts) 상세 화면(app/w/[slug]/page.tsx, R96)에도 이미 렌더되는데,
            계획서 스케치의 폼에는 입력란 자체가 없었다 — 상세 화면이 보여주는
            "본문"을 채울 방법이 폼에 없는 셈이었다. */}
        <div>
          <span className="label">본문</span>
          <MarkdownEditor
            value={form.bodyMd}
            maxLength={TERM_MARKDOWN_MAX}
            onChange={(bodyMd) => updateField("bodyMd", bodyMd)}
            disabled={locked}
            onUploadingChange={setImageUploading}
          />
        </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <FormSectionTitle icon={<IconTags />} title="추가 표기" description="대표 표기 외에 검색되어야 하거나 피해야 할 이름을 등록합니다.">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => addSurface("canonical")} disabled={locked} className="btn-ghost btn-sm shrink-0"><IconPlus />표준 표기</button>
            <button type="button" onClick={() => addSurface("abbreviation")} disabled={locked} className="btn-ghost btn-sm shrink-0"><IconPlus />약어</button>
            <button type="button" onClick={() => addSurface("alias")} disabled={locked} className="btn-quiet btn-sm shrink-0"><IconPlus />기타</button>
          </div>
        </FormSectionTitle>
        <div className="p-4 sm:p-5">
          <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_6rem_8rem_2.5rem] gap-2 px-2 text-[11px] font-medium text-ink-3 sm:grid">
            <span>표기</span><span>언어</span><span>종류</span><span className="sr-only">작업</span>
          </div>
            {/* 표준명에서 자동으로 파생되는 표기는 여기 나타나지 않는다(R110의
                pickExplicitSurfaces). 그 사실을 적어두지 않으면 빈 목록을 보고
                "표기가 하나도 없다"고 오해한다. */}
        <div className="space-y-2">
          {form.surfaces.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line bg-panel-2/40 p-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_2.5rem]">
              <input
                name={`surface-${i}-text`}
                autoComplete="off"
                aria-label={`추가 표기 ${i + 1}`}
                value={s.text}
                maxLength={TERM_NAME_MAX}
                onChange={(e) => updateSurface(i, { text: e.target.value })}
                disabled={locked}
                placeholder="표기…"
                className="field min-w-0 py-1.5"
              />
              <select
                name={`surface-${i}-lang`}
                aria-label={`추가 표기 ${i + 1} 언어`}
                value={s.lang}
                onChange={(e) => updateSurface(i, { lang: e.target.value })}
                disabled={locked}
                className="field py-1.5"
              >
                {SURFACE_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
              <select
                name={`surface-${i}-kind`}
                aria-label={`추가 표기 ${i + 1} 종류`}
                value={s.kind}
                onChange={(e) => updateSurface(i, { kind: e.target.value })}
                disabled={locked}
                className="field py-1.5"
              >
                {EXPLICIT_SURFACE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SURFACE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`${s.text || `추가 표기 ${i + 1}`} 삭제`}
                title="표기 삭제"
                onClick={() => removeSurface(i)}
                disabled={locked}
                className="btn-quiet btn-sm h-10 w-10 px-0 text-ink-3 hover:text-danger"
              >
                <IconTrash />
              </button>
            </div>
          ))}
          {form.surfaces.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-4 py-7 text-center">
              <IconTags className="mx-auto mb-2 text-ink-3" />
              <p className="text-sm text-ink-2">아직 추가 표기가 없습니다.</p>
              <p className="mt-1 text-xs text-ink-3">대표 표기는 저장할 때 자동으로 표준 표기에 포함됩니다.</p>
            </div>
          )}
        </div>
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-xl border border-line bg-panel/90 p-3 shadow-lg backdrop-blur">
        {savedSlug ? (
          <Link href={`/w/${savedSlug}`} className="btn-primary">
            저장됨 → {savedSlug}로 이동
          </Link>
        ) : (
          <button type="submit" disabled={saving || imageUploading} className="btn-primary">
            {imageUploading ? "이미지 변환 중…" : saving ? "저장 중…" : "저장"}
          </button>
        )}
        <Link href={editSlug !== undefined ? `/w/${editSlug}` : "/sheet"} className="btn-quiet">
          취소
        </Link>
      </div>
    </form>
  );
}

function FormSectionTitle({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line bg-panel-2/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-ink-3">{description}</p>
        </div>
      </div>
      {children}
    </header>
  );
}

function IconIdentity() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <circle cx="7" cy="8" r="2" />
      <path d="M4.5 13c.6-1.5 1.4-2.2 2.5-2.2s1.9.7 2.5 2.2M12 7h3.2M12 10h3.2M12 13h2" strokeLinecap="round" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 2.75h7l3 3V17.25H5z" strokeLinejoin="round" />
      <path d="M12 2.75v3h3M7.5 9h5M7.5 12h5M7.5 15h3" strokeLinecap="round" />
    </svg>
  );
}

function IconTags({ className }: { className?: string } = {}) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m10.5 3.5 6 6-6.7 6.7-6-6V3.5z" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1" />
    </svg>
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
