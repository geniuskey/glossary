"use client";

import { useState } from "react";
import type { WorkspaceHomeMode } from "@glossary/db";
import {
  DEFAULT_HOME_CONTENT,
  HOME_CONTENT_LIMITS,
  type HomeContent,
} from "@/lib/workspace/home-content-values";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";

export function HomeContentPanel({ initialContent, initialMode, aiAvailable }: { initialContent: HomeContent; initialMode: WorkspaceHomeMode; aiAvailable: boolean }) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [mode, setMode] = useState<WorkspaceHomeMode>(initialMode);
  const [savedMode, setSavedMode] = useState<WorkspaceHomeMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const valid = content.eyebrow.trim().length > 0 && content.title.trim().length > 0 && content.description.trim().length > 0;
  const dirty = JSON.stringify(content) !== JSON.stringify(savedContent) || mode !== savedMode;
  useUnsavedChanges(dirty);

  function update<K extends keyof HomeContent>(key: K, value: HomeContent[K]) {
    setContent((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function loadDefaults() {
    if (dirty && !window.confirm("작성 중인 문구를 기본 문구로 바꿀까요? 저장하기 전까지 실제 홈 화면은 바뀌지 않습니다.")) return;
    setContent(DEFAULT_HOME_CONTENT);
    setMode("search");
    setMessage(null);
  }

  async function save() {
    if (saving || !valid) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/home-content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(content),
      });
      const body = (await res.json().catch(() => null)) as
        | { settings?: HomeContent; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.settings) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `저장하지 못했습니다 (${res.status}).` });
        return;
      }
      if (mode !== savedMode) {
        const modeResponse = await fetch("/api/v1/admin/home-mode", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const modeBody = await modeResponse.json().catch(() => null) as { mode?: WorkspaceHomeMode; error?: { message?: string } } | null;
        if (!modeResponse.ok || !modeBody?.mode) {
          setContent(body.settings);
          setSavedContent(body.settings);
          setMessage({ kind: "bad", text: modeBody?.error?.message ?? `홈 입력 방식을 저장하지 못했습니다 (${modeResponse.status}).` });
          return;
        }
        setMode(modeBody.mode);
        setSavedMode(modeBody.mode);
      }
      setContent(body.settings);
      setSavedContent(body.settings);
      setMessage({ kind: "ok", text: "홈 화면 설정을 저장했습니다." });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="home-content-heading">
      <div className="mb-3">
        <h2 id="home-content-heading" className="text-base font-semibold text-ink text-balance">홈 소개 문구</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          이 용어집을 사용하는 조직과 특화 분야를 첫 화면에서 분명하게 알려 주세요.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="card space-y-4 p-4 sm:p-5">
          <fieldset className="border-b border-line pb-4">
            <legend className="label">홈 첫 화면 입력 방식</legend>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">방문자가 처음 만나는 입력창을 검색 또는 용어 챗봇으로 선택합니다. 채팅은 AI 연결이 정상적으로 활성화된 경우에만 홈에 표시됩니다.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <ModeOption mode="search" value={mode} disabled={saving} onChange={setMode} title="용어 검색" body="약어·별칭·금지 표기를 빠르게 찾습니다." />
              <ModeOption mode="chat" value={mode} disabled={saving || !aiAvailable} onChange={setMode} title="용어 챗봇" body={aiAvailable ? "용어집에 근거해 질문을 시작합니다." : "AI 연결을 활성화하면 사용할 수 있습니다."} />
            </div>
          </fieldset>
          <TextField
            label="조직 또는 용어집 라벨"
            hint="대표 문구 위에 작게 표시됩니다. 예: Camera Platform Group"
            value={content.eyebrow}
            maxLength={HOME_CONTENT_LIMITS.eyebrow}
            disabled={saving}
            onChange={(value) => update("eyebrow", value)}
          />
          <TextField
            label="대표 문구"
            hint="특화 분야와 사용 조직을 한 문장으로 표현하세요. 줄바꿈할 수 있습니다."
            value={content.title}
            maxLength={HOME_CONTENT_LIMITS.title}
            rows={3}
            disabled={saving}
            onChange={(value) => update("title", value)}
          />
          <TextField
            label="소개 문구"
            hint="무엇을 찾고 정리하는 용어집인지 구체적으로 적어 주세요."
            value={content.description}
            maxLength={HOME_CONTENT_LIMITS.description}
            rows={4}
            disabled={saving}
            onChange={(value) => update("description", value)}
          />

          {message && (
            <p role={message.kind === "bad" ? "alert" : "status"} className={cx(message.kind === "bad" ? "note-danger" : "note-ok")}>
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <span className="mr-auto text-xs text-ink-3" role="status">{dirty ? "저장하지 않은 변경사항" : "저장된 문구와 같습니다"}</span>
            <button type="button" disabled={saving} onClick={loadDefaults} className="btn-quiet btn-sm">
              기본 문구 불러오기
            </button>
            <button type="button" disabled={saving || !valid || !dirty} onClick={() => void save()} className="btn-primary btn-sm">
              {saving ? "저장 중…" : "홈 문구 저장"}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-paper p-5 sm:p-8" aria-label="홈 문구 미리보기">
          <p className="text-[10px] font-semibold text-brand">미리보기</p>
          <div className="mt-8 text-center">
            <p className="text-xs font-semibold text-brand">{content.eyebrow || "—"}</p>
            <h3 className="mt-4 whitespace-pre-line text-3xl font-semibold leading-[1.16] tracking-[-0.045em] text-ink">
              {content.title || "대표 문구를 입력하세요"}
            </h3>
            <p className="mx-auto mt-4 max-w-lg whitespace-pre-line text-sm leading-7 text-ink-2">
              {content.description || "소개 문구를 입력하세요"}
            </p>
            <div className="mx-auto mt-7 flex h-11 max-w-md items-center rounded-xl border border-line bg-panel px-4 text-left text-sm text-ink-3 shadow-sm">
              {mode === "chat" && aiAvailable ? "무엇이든 물어보세요…" : "용어를 검색하세요…"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeOption({ mode, value, disabled, onChange, title, body }: { mode: WorkspaceHomeMode; value: WorkspaceHomeMode; disabled: boolean; onChange: (mode: WorkspaceHomeMode) => void; title: string; body: string }) {
  const selected = value === mode;
  return <label className={cx("flex cursor-pointer gap-2.5 rounded-xl border p-3 transition", selected ? "border-brand/50 bg-brand-soft/45" : "border-line bg-panel hover:border-line-strong", disabled && "cursor-not-allowed opacity-55")}>
    <input type="radio" name="home-mode" value={mode} checked={selected} disabled={disabled} onChange={() => onChange(mode)} className="mt-0.5 h-4 w-4 accent-brand" />
    <span><span className="block text-sm font-medium text-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-ink-3">{body}</span></span>
  </label>;
}

function TextField({
  label,
  hint,
  value,
  maxLength,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  maxLength: number;
  rows?: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const control = rows ? (
    <textarea required disabled={disabled} value={value} maxLength={maxLength} rows={rows} onChange={(event) => onChange(event.target.value)} className="field resize-y" />
  ) : (
    <input required disabled={disabled} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="field" />
  );

  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-ink-3">{value.length}/{maxLength}</span>
      </span>
      {control}
      <span className="mt-1.5 block text-xs leading-5 text-ink-3">{hint}</span>
    </label>
  );
}
