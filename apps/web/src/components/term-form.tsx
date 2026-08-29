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
  type SurfaceLangLiteral,
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

// F6/P1(query.ts의 규약): `Record<유니온, T>` + 폴백 없음. 화면에 "neutral"이
// 그대로 노출되면 사용자는 그게 언어 코드인지 상태인지 알 수 없다.
const LANG_LABEL: Record<SurfaceLangLiteral, string> = {
  en: "영문",
  ko: "국문",
  neutral: "공통",
};

const EMPTY: TermFormState = {
  termType: "term",
  nameEn: "",
  nameKo: "",
  fullNameEn: "",
  fullNameKo: "",
  domain: "",
  status: "active",
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
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      {conflict && (
        <div className="note note-warn">
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
        <div className="note note-danger">
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
        <div className="note note-warn">
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

      <section className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">용어 종류</span>
            <select
              value={form.termType}
              onChange={(e) => updateField("termType", e.target.value)}
              disabled={locked}
              className="field"
            >
              {TERM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TERM_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">상태</span>
            <select
              value={form.status}
              onChange={(e) => updateField("status", e.target.value)}
              disabled={locked}
              className="field"
            >
              {TERM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TERM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">영문 표준명</span>
            <input
              value={form.nameEn}
              onChange={(e) => updateField("nameEn", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          <label className="block">
            <span className="label">국문 표준명</span>
            <input
              value={form.nameKo}
              onChange={(e) => updateField("nameKo", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          <label className="block">
            <span className="label">영문 풀네임</span>
            <input
              value={form.fullNameEn}
              onChange={(e) => updateField("fullNameEn", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          <label className="block">
            <span className="label">국문 풀네임</span>
            <input
              value={form.fullNameKo}
              onChange={(e) => updateField("fullNameKo", e.target.value)}
              disabled={locked}
              className="field"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="label">도메인 (쉼표로 구분)</span>
            <input
              value={form.domain}
              onChange={(e) => updateField("domain", e.target.value)}
              disabled={locked}
              placeholder="ISP, PM"
              className="field"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-ink-3">영문 표준명과 국문 표준명 중 최소 하나는 있어야 합니다.</p>
      </section>

      <section className="card space-y-3 p-4">
        <label className="block">
          <span className="label">정의</span>
          <textarea
            value={form.definitionMd}
            onChange={(e) => updateField("definitionMd", e.target.value)}
            disabled={locked}
            rows={3}
            placeholder="한두 문장으로 이 용어가 무엇인지"
            className="field"
          />
        </label>

        {/* R111: bodyMd는 terms.body_md 컬럼에 이미 저장되고(lib/terms/create.ts,
            update.ts) 상세 화면(app/w/[slug]/page.tsx, R96)에도 이미 렌더되는데,
            계획서 스케치의 폼에는 입력란 자체가 없었다 — 상세 화면이 보여주는
            "본문"을 채울 방법이 폼에 없는 셈이었다. */}
        <label className="block">
          <span className="label">본문</span>
          <textarea
            value={form.bodyMd}
            onChange={(e) => updateField("bodyMd", e.target.value)}
            disabled={locked}
            rows={6}
            placeholder="배경, 사용 예, 쓰면 안 되는 맥락 등"
            className="field"
          />
        </label>
      </section>

      <section className="card p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <span className="label mb-0">표기</span>
            {/* 표준명에서 자동으로 파생되는 표기는 여기 나타나지 않는다(R110의
                pickExplicitSurfaces). 그 사실을 적어두지 않으면 빈 목록을 보고
                "표기가 하나도 없다"고 오해한다. */}
            <p className="text-xs text-ink-3">표준명에서 자동으로 만들어지는 표기 외에, 따로 등록할 것만 적습니다.</p>
          </div>
          <button type="button" onClick={addSurface} disabled={locked} className="btn-ghost btn-sm shrink-0">
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
                className="field flex-1 py-1.5"
              />
              <select
                value={s.lang}
                onChange={(e) => updateSurface(i, { lang: e.target.value })}
                disabled={locked}
                className="field w-24 py-1.5"
              >
                {SURFACE_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
              <select
                value={s.kind}
                onChange={(e) => updateSurface(i, { kind: e.target.value })}
                disabled={locked}
                className="field w-28 py-1.5"
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
                className="btn-quiet btn-sm text-ink-3 hover:text-danger"
              >
                삭제
              </button>
            </div>
          ))}
          {form.surfaces.length === 0 && (
            <p className="py-2 text-center text-xs text-ink-3">등록된 별칭·약어·금지 표기가 없습니다.</p>
          )}
        </div>
      </section>

      <div className="flex items-center gap-2">
        {savedSlug ? (
          <Link href={`/w/${savedSlug}`} className="btn-primary">
            저장됨 → {savedSlug}로 이동
          </Link>
        ) : (
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "저장 중..." : "저장"}
          </button>
        )}
        <Link href={editSlug !== undefined ? `/w/${editSlug}` : "/sheet"} className="btn-quiet">
          취소
        </Link>
      </div>
    </form>
  );
}
