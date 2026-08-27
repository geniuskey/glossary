"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  EXPLICIT_SURFACE_KINDS,
  SURFACE_KIND_LABEL,
  SURFACE_LANGS,
  TERM_STATUSES,
  TERM_STATUS_LABEL,
  TERM_TYPES,
  TERM_TYPE_LABEL,
} from "@/lib/terms/enums";
import { buildTermPayload, type SurfaceDraft, type TermFormState } from "@/lib/terms/form-payload";
import { interpretResponse, type FormOutcome } from "@/lib/terms/form-response";

export interface TermFormInitial extends TermFormState {
  slug?: string;
  // R109: 편집 경로에만 붙는다. 생성 요청 페이로드에는 이 필드 자체가 없어야
  // 한다(schema.ts의 termInputSchema는 이 필드를 모른다 — termPatchSchema만
  // .extend()로 받는다).
  expectedRevision?: number;
}

const EMPTY: TermFormState = {
  termType: "term",
  nameEn: "",
  nameKo: "",
  fullNameEn: "",
  fullNameKo: "",
  domain: "",
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

export function TermForm({ initial }: { initial?: TermFormInitial }) {
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

  const locked = saving || savedSlug !== null;

  function updateField<K extends keyof TermFormState>(key: K, value: TermFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateSurface(index: number, patch: Partial<SurfaceDraft>) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addSurface() {
    setForm((f) => ({ ...f, surfaces: [...f.surfaces, { text: "", lang: "neutral", kind: "alias" }] }));
  }

  function removeSurface(index: number) {
    setForm((f) => ({ ...f, surfaces: f.surfaces.filter((_, i) => i !== index) }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // R108: 방어선 두 번째 겹. 버튼이 이미 링크로 바뀐 뒤라도 Enter 키 등으로
    // submit 이벤트가 다시 뜰 수 있는 경로를 여기서도 막는다.
    if (locked) return;

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
        router.push(`/terms/${outcome.term.slug}`);
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
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      {conflict && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{conflict.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded border border-amber-400 px-3 py-1 text-amber-900"
          >
            새로고침
          </button>
        </div>
      )}

      {errorMessage && !conflict && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p>{errorMessage}</p>
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
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 font-medium">같은 표기의 다른 용어가 있습니다</p>
          <ul className="space-y-0.5">
            {warnings.map((w) => (
              <li key={`${w.surfaceText}:${w.conflictingSlug}`}>
                {w.surfaceText} →{" "}
                <Link href={`/terms/${w.conflictingSlug}`} className="underline">
                  {w.conflictingSlug}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">용어 종류</span>
          <select
            value={form.termType}
            onChange={(e) => updateField("termType", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          >
            {TERM_TYPES.map((t) => (
              <option key={t} value={t}>
                {TERM_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">상태</span>
          <select
            value={form.status}
            onChange={(e) => updateField("status", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          >
            {TERM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TERM_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">영문명</span>
          <input
            value={form.nameEn}
            onChange={(e) => updateField("nameEn", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">한글명</span>
          <input
            value={form.nameKo}
            onChange={(e) => updateField("nameKo", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">영문 풀네임</span>
          <input
            value={form.fullNameEn}
            onChange={(e) => updateField("fullNameEn", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">한글 풀네임</span>
          <input
            value={form.fullNameKo}
            onChange={(e) => updateField("fullNameKo", e.target.value)}
            disabled={locked}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">도메인 (쉼표로 구분)</span>
        <input
          value={form.domain}
          onChange={(e) => updateField("domain", e.target.value)}
          disabled={locked}
          placeholder="ISP, PM"
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">정의</span>
        <textarea
          value={form.definitionMd}
          onChange={(e) => updateField("definitionMd", e.target.value)}
          disabled={locked}
          rows={3}
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>

      {/* R111: bodyMd는 terms.body_md 컬럼에 이미 저장되고(lib/terms/create.ts,
          update.ts) 상세 화면(app/terms/[slug]/page.tsx, R96)에도 이미 렌더되는데,
          계획서 스케치의 폼에는 입력란 자체가 없었다 — 상세 화면이 보여주는
          "본문"을 채울 방법이 폼에 없는 셈이었다. */}
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">본문</span>
        <textarea
          value={form.bodyMd}
          onChange={(e) => updateField("bodyMd", e.target.value)}
          disabled={locked}
          rows={6}
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-slate-600">표기</span>
          <button
            type="button"
            onClick={addSurface}
            disabled={locked}
            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            표기 추가
          </button>
        </div>
        <div className="space-y-2">
          {form.surfaces.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={s.text}
                onChange={(e) => updateSurface(i, { text: e.target.value })}
                disabled={locked}
                placeholder="표기"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <select
                value={s.lang}
                onChange={(e) => updateSurface(i, { lang: e.target.value })}
                disabled={locked}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {SURFACE_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                value={s.kind}
                onChange={(e) => updateSurface(i, { kind: e.target.value })}
                disabled={locked}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {EXPLICIT_SURFACE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SURFACE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeSurface(i)}
                disabled={locked}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      {savedSlug ? (
        <Link href={`/terms/${savedSlug}`} className="inline-block rounded bg-slate-900 px-4 py-2 text-white">
          저장됨 → {savedSlug}로 이동
        </Link>
      ) : (
        <button type="submit" disabled={saving} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
      )}
    </form>
  );
}
