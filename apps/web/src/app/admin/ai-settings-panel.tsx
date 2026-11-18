"use client";

import { useEffect, useRef, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import { AI_PROVIDERS, AI_PROVIDER_LABEL, type AiProvider, type PublicAiConfig } from "@/lib/ai/config-values";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";
import { headerDraftsOf, headerPayload, newHeaderDraft, type HeaderDraft } from "@/lib/admin/header-drafts";
import { AdminPanelHeader, AdminSaveBar, StatusBadge } from "./admin-ui";

interface ModelOption { id: string; label: string }

export function AiSettingsPanel({ initialConfig }: { initialConfig: PublicAiConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [headers, setHeaders] = useState<HeaderDraft[]>(() => headerDraftsOf(initialConfig.customHeaders));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const autoVerifyStarted = useRef(false);
  const usableKey = !clearApiKey && (Boolean(apiKey.trim()) || config.hasApiKey);
  const headersReady = config.provider !== "openai_compatible" || headers.every((header) => Boolean(
    header.name.trim() && (header.value || header.configured),
  ));
  const canLoadModels = Boolean(config.baseUrl.trim()) && config.secretsReadable && headersReady
    && (config.provider !== "gemini" || usableKey);
  const shouldAutoLoadModels = canLoadModels && (config.provider === "ollama" || usableKey || headers.some((header) => Boolean(header.value || header.configured)));
  const needsSecretEncryption = config.provider === "gemini" || apiKey.trim().length > 0 || config.hasApiKey || headers.length > 0;
  useUnsavedChanges(dirty);
  const connectionFingerprint = JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey,
    clearApiKey,
    hasApiKey: config.hasApiKey,
    headers: headerPayload(headers),
  });

  async function loadModels(signal?: AbortSignal) {
    if (!canLoadModels) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const response = await fetch("/api/v1/admin/ai-config/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          baseUrl: config.baseUrl,
          apiKey: config.provider === "ollama" ? null : clearApiKey ? null : apiKey || undefined,
          customHeaders: config.provider === "openai_compatible" ? headerPayload(headers) : [],
        }),
        signal,
      });
      const body = await response.json().catch(() => null) as { models?: ModelOption[]; error?: { message?: string } } | null;
      if (!response.ok || !body?.models) {
        setModels([]);
        setModelError(body?.error?.message || `모델 목록을 불러오지 못했습니다 (${response.status}).`);
        return;
      }
      setModels(body.models);
      if (body.models.length === 0) setModelError("이 연결에서 사용할 수 있는 생성 모델을 찾지 못했습니다.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setModels([]);
        setModelError("모델 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (!signal?.aborted) setLoadingModels(false);
    }
  }

  useEffect(() => {
    setModels([]);
    setModelError(null);
    setLoadingModels(false);
    if (!shouldAutoLoadModels) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadModels(controller.signal), 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  // connectionFingerprint is an intentional scalar snapshot of connection inputs.
  }, [connectionFingerprint, shouldAutoLoadModels]);

  useEffect(() => {
    const hasConnectionToVerify = initialConfig.hasApiKey || initialConfig.customHeaders.length > 0 || initialConfig.enabled;
    if (autoVerifyStarted.current || !initialConfig.secretsReadable || !hasConnectionToVerify) return;
    autoVerifyStarted.current = true;
    void verifyConnection(false);
  // 저장된 설정은 이 화면을 열 때 한 번만 실제 생성 요청으로 확인한다.
  }, []);

  function update<K extends keyof Pick<PublicAiConfig, "enabled" | "autoReviewEnabled" | "provider" | "baseUrl" | "model">>(key: K, value: PublicAiConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage(null);
    setConnectionMessage(null);
    if (key === "baseUrl") setConnected(false);
  }

  function changeProvider(provider: AiProvider) {
    setConfig((current) => ({
      ...current,
      provider,
      baseUrl: provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : current.provider === "gemini" ? "http://localhost:11434/v1" : current.baseUrl,
      model: provider === current.provider ? current.model : provider === "gemini" ? "gemini-3.6-flash" : "",
    }));
    if (provider === "ollama") {
      setApiKey("");
      setClearApiKey(false);
    }
    setDirty(true);
    setMessage(null);
    setConnectionMessage(null);
    setConnected(false);
  }

  function updateHeader(id: string, key: "name" | "value", value: string) {
    editHeaders((current) => current.map((header) => header.id === id ? { ...header, [key]: value } : header));
  }

  function reset() {
    setConfig(savedConfig);
    setApiKey("");
    setClearApiKey(false);
    setHeaders(headerDraftsOf(savedConfig.customHeaders));
    setDirty(false);
    setMessage(null);
    setConnectionMessage(null);
  }

  function editHeaders(next: (current: HeaderDraft[]) => HeaderDraft[]) {
    setHeaders(next);
    setDirty(true);
    setMessage(null);
    setConnectionMessage(null);
    setConnected(false);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setConnectionMessage(null);
    try {
      const response = await fetch("/api/v1/admin/ai-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: config.enabled,
          autoReviewEnabled: config.autoReviewEnabled,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.provider === "ollama"
            ? config.hasApiKey ? null : undefined
            : clearApiKey ? null : apiKey || undefined,
          customHeaders: config.provider === "openai_compatible" ? headerPayload(headers) : [],
        }),
      });
      const body = await response.json().catch(() => null) as { config?: PublicAiConfig; error?: { message?: string; details?: { formErrors?: string[] } } } | null;
      if (!response.ok || !body?.config) {
        const details = body?.error?.details?.formErrors?.join(" ");
        setMessage({ kind: "bad", text: details || body?.error?.message || `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setConfig(body.config);
      setSavedConfig(body.config);
      setApiKey("");
      setClearApiKey(false);
      setHeaders(headerDraftsOf(body.config.customHeaders));
      setDirty(false);
      setMessage({ kind: "ok", text: "AI 연결 설정을 저장했습니다." });
      await verifyConnection(false);
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function verifyConnection(announceSuccess: boolean) {
    setTesting(true);
    setConnected(false);
    setConnectionMessage(null);
    if (announceSuccess) setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/ai-config/test", { method: "POST" });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
      const connectionSucceeded = response.ok && body?.ok;
      setConnected(Boolean(connectionSucceeded));
      if (connectionSucceeded) {
        if (announceSuccess) setMessage({ kind: "ok", text: "AI 연결에 성공했습니다." });
      } else {
        const text = body?.error?.message || `연결하지 못했습니다 (${response.status}).`;
        if (announceSuccess) setMessage({ kind: "bad", text });
        else setConnectionMessage(text);
      }
      return Boolean(connectionSucceeded);
    } catch {
      if (announceSuccess) setMessage({ kind: "bad", text: "AI 서버에 연결하지 못했습니다." });
      else setConnectionMessage("AI 서버에 연결하지 못했습니다.");
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function testConnection() {
    if (testing || dirty) return;
    await verifyConnection(true);
  }

  // 성공했을 때만 배지를 띄우면 "확인 안 함"과 "실패"가 화면에서 구분되지 않는다.
  const connectionStatus = !savedConfig.enabled
    ? <StatusBadge tone="neutral">꺼짐</StatusBadge>
    : testing
      ? <StatusBadge tone="neutral">연결 확인 중…</StatusBadge>
      : connected
        ? <span role="status"><StatusBadge tone="ok">연결됨</StatusBadge></span>
        : connectionMessage
          ? <StatusBadge tone="danger">연결 실패</StatusBadge>
          : <StatusBadge tone="neutral">확인 전</StatusBadge>;

  return (
    <section aria-labelledby="ai-settings-heading">
      <AdminPanelHeader
        id="ai-settings-heading"
        title="AI 연결"
        description="챗봇과 정리 대기 용어 자동 검토에 쓸 생성 모델을 연결합니다."
        help={<HelpTip text="챗봇은 관련 공개 용어를, 자동 검토는 정리 대기 용어의 내용을 설정한 AI 서버로 보냅니다. 연결 정보는 관리자만 변경할 수 있습니다." />}
        status={connectionStatus}
      />

      {!config.encryptionReady && needsSecretEncryption && (
        <div className="note note-warn mb-3" role="alert">
          서버에 <code>GLOSSARY_ENCRYPTION_KEY</code>를 32자 이상으로 설정해야 API 키와 header 값을 저장할 수 있습니다.
        </div>
      )}
      {!config.secretsReadable && (
        <div className="note note-warn mb-3" role="alert">저장된 비밀값을 읽을 수 없습니다. 서버의 암호화 키가 변경되지 않았는지 확인해 주세요.</div>
      )}

      <div className="card overflow-hidden">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-3 rounded-lg border border-line bg-panel-2/45 px-3 sm:col-span-2">
            <input type="checkbox" name="aiEnabled" checked={config.enabled} onChange={(event) => update("enabled", event.target.checked)} disabled={saving} className="h-4 w-4 accent-[var(--brand)]" />
            <span className="text-sm font-medium text-ink">AI 기능 사용</span>
            <span className="ml-auto text-xs text-ink-3">챗봇과 자동 검토의 기본 연결</span>
          </label>
          <label className="flex min-h-10 items-center gap-3 rounded-lg border border-line bg-panel-2/45 px-3 sm:col-span-2">
            <input type="checkbox" name="aiAutoReviewEnabled" checked={config.autoReviewEnabled} onChange={(event) => update("autoReviewEnabled", event.target.checked)} disabled={saving || !config.enabled} className="h-4 w-4 accent-[var(--brand)]" />
            <span className="text-sm font-medium text-ink">정리 대기 용어 자동 검토</span>
            <span className="ml-auto text-xs text-ink-3">대기 용어를 AI에 보내 제안을 미리 생성</span>
          </label>

          <label className="block">
            <span className="label">공급자</span>
            <select name="aiProvider" value={config.provider} onChange={(event) => changeProvider(event.target.value as AiProvider)} disabled={saving} className="field">
              {AI_PROVIDERS.map((provider) => <option key={provider} value={provider}>{AI_PROVIDER_LABEL[provider]}</option>)}
            </select>
          </label>
          <div className="block">
            <span className="label flex items-center gap-2">
              <label htmlFor="ai-model">모델</label>
              {loadingModels && <span className="ml-auto font-normal text-ink-3" role="status">목록 불러오는 중…</span>}
              {!loadingModels && canLoadModels && <button type="button" className="ml-auto font-normal text-brand hover:underline" onClick={() => void loadModels()} disabled={saving}>새로고침</button>}
            </span>
            {models.length > 0 ? (
              <select id="ai-model" name="aiModel" value={config.model} onChange={(event) => update("model", event.target.value)} disabled={saving || loadingModels} className="field">
                {!config.model && <option value="">모델 선택…</option>}
                {config.model && !models.some((model) => model.id === config.model) && <option value={config.model}>{config.model} · 현재 입력값</option>}
                {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            ) : (
              <input id="ai-model" name="aiModel" autoComplete="off" value={config.model} onChange={(event) => update("model", event.target.value)} disabled={saving} placeholder="모델 ID를 입력하거나 새로고침으로 불러오세요…" className="field" />
            )}
            {modelError && <p className="mt-1 text-[11px] leading-4 text-danger" role="alert">{modelError} 직접 입력한 모델 이름은 그대로 저장할 수 있습니다.</p>}
          </div>
          <label className="block sm:col-span-2">
            <span className="label">API Base URL</span>
            <input name="aiBaseUrl" type="url" autoComplete="off" value={config.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} disabled={saving} placeholder="예: https://api.example.com/v1…" className="field font-mono text-xs" />
          </label>
          {config.provider === "ollama" ? (
            <p className="note sm:col-span-2">Ollama 연결은 API Key 없이 사용할 수 있습니다. Base URL에 Ollama 주소를 입력하세요. 예: <code>http://localhost:11434/v1</code></p>
          ) : (
            <label className="block sm:col-span-2">
              <span className="label inline-flex items-center gap-1.5">API Key <HelpTip text="키는 선택 사항입니다. 입력하면 선택 가능한 모델을 자동으로 불러옵니다. 저장 후에는 값을 다시 표시하지 않으며, 빈 칸으로 저장하면 기존 키를 유지합니다." /></span>
              <div className="flex gap-2">
                <input name="aiApiKey" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); setDirty(true); setMessage(null); setConnectionMessage(null); setConnected(false); }} disabled={saving || clearApiKey} placeholder={config.hasApiKey ? "저장된 키 유지…" : "API Key (선택)…"} className="field min-w-0 flex-1 font-mono" />
                {config.hasApiKey && <button type="button" className={cx("btn-sm", clearApiKey ? "btn-danger" : "btn-ghost")} onClick={() => { setClearApiKey((value) => !value); setDirty(true); setMessage(null); setConnectionMessage(null); setConnected(false); }} disabled={saving}>{clearApiKey ? "제거 예정" : "키 제거"}</button>}
              </div>
            </label>
          )}
        </div>

        {config.provider === "openai_compatible" && (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium text-ink">추가 요청 헤더</h3>
              <HelpTip text="Authorization, api-key, 조직 식별자처럼 공급자가 요구하는 값을 추가합니다. 위험한 전송·프록시 헤더는 저장할 수 없습니다." />
              <button type="button" className="btn-ghost btn-sm ml-auto" disabled={saving || headers.length >= 20} onClick={() => editHeaders((current) => [...current, newHeaderDraft()])}>+ 헤더 추가</button>
            </div>
            {headers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">추가 헤더가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {headers.map((header, index) => (
                  <div key={header.id} className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(10rem,1fr)_auto] gap-2">
                    <label className="sr-only" htmlFor={`ai-header-name-${header.id}`}>헤더 {index + 1} 이름</label>
                    <input id={`ai-header-name-${header.id}`} autoComplete="off" value={header.name} onChange={(event) => updateHeader(header.id, "name", event.target.value)} disabled={saving} placeholder="예: X-Organization…" className="field h-9 font-mono text-xs" />
                    <label className="sr-only" htmlFor={`ai-header-value-${header.id}`}>헤더 {index + 1} 값</label>
                    <input id={`ai-header-value-${header.id}`} type="password" autoComplete="new-password" value={header.value} onChange={(event) => updateHeader(header.id, "value", event.target.value)} disabled={saving} placeholder={header.configured ? "저장된 값 유지…" : "헤더 값…"} className="field h-9 font-mono text-xs" />
                    <button type="button" aria-label={`${header.name || `헤더 ${index + 1}`} 제거`} className="btn-quiet h-9 w-9 p-0" disabled={saving} onClick={() => editHeaders((current) => current.filter((item) => item.id !== header.id))}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {connectionMessage && !dirty && (
          <p role="alert" className="border-t border-line bg-danger-soft/40 px-4 py-2.5 text-xs text-danger">연결 테스트 실패: {connectionMessage}</p>
        )}
      </div>

      <AdminSaveBar dirty={dirty} saving={saving} message={message} saveLabel="AI 연결 저장" onSave={() => void save()} onReset={reset}>
        {dirty && <span className="text-[11px] text-ink-3">연결 테스트는 저장한 설정으로 실행됩니다</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={() => void testConnection()} disabled={saving || testing || dirty || !config.secretsReadable} title={dirty ? "저장한 뒤 테스트할 수 있습니다" : undefined}>{testing ? "연결 확인 중…" : "연결 테스트"}</button>
      </AdminSaveBar>
    </section>
  );
}
