"use client";

import { useEffect, useRef, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import { AI_PROVIDERS, AI_PROVIDER_LABEL, type AiProvider, type PublicAiConfig } from "@/lib/ai/config-values";
import { cx } from "@/lib/ui/format";

interface HeaderDraft { name: string; value: string; configured?: boolean }
interface ModelOption { id: string; label: string }

export function AiSettingsPanel({ initialConfig }: { initialConfig: PublicAiConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [headers, setHeaders] = useState<HeaderDraft[]>(() => initialConfig.customHeaders.map((header) => ({ ...header, value: "" })));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const autoVerifyStarted = useRef(false);
  const usableKey = !clearApiKey && (Boolean(apiKey.trim()) || config.hasApiKey);
  const headersReady = config.provider === "gemini" || headers.every((header) => Boolean(
    header.name.trim() && (header.value || header.configured),
  ));
  const canLoadModels = Boolean(config.baseUrl.trim()) && config.secretsReadable && headersReady
    && (config.provider === "openai_compatible" || usableKey);
  const shouldAutoLoadModels = canLoadModels && (usableKey || headers.some((header) => Boolean(header.value || header.configured)));
  const connectionFingerprint = JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey,
    clearApiKey,
    hasApiKey: config.hasApiKey,
    headers,
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
          apiKey: clearApiKey ? null : apiKey || undefined,
          customHeaders: config.provider === "openai_compatible" ? headers : [],
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionFingerprint, shouldAutoLoadModels]);

  useEffect(() => {
    const hasConnectionToVerify = initialConfig.hasApiKey || initialConfig.customHeaders.length > 0 || initialConfig.enabled;
    if (autoVerifyStarted.current || !initialConfig.secretsReadable || !hasConnectionToVerify) return;
    autoVerifyStarted.current = true;
    void verifyConnection(false);
  // 저장된 설정은 이 화면을 열 때 한 번만 실제 생성 요청으로 확인한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof Pick<PublicAiConfig, "enabled" | "autoReviewEnabled" | "provider" | "baseUrl" | "model">>(key: K, value: PublicAiConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage(null);
    if (key === "baseUrl") setConnected(false);
  }

  function changeProvider(provider: AiProvider) {
    setConfig((current) => ({
      ...current,
      provider,
      baseUrl: provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : current.provider === "gemini" ? "http://localhost:11434/v1" : current.baseUrl,
      model: provider === "gemini" && current.provider !== "gemini" ? "gemini-3.6-flash" : current.model,
    }));
    setDirty(true);
    setMessage(null);
    setConnected(false);
  }

  function updateHeader(index: number, key: "name" | "value", value: string) {
    setHeaders((current) => current.map((header, itemIndex) => itemIndex === index ? { ...header, [key]: value } : header));
    setDirty(true);
    setMessage(null);
    setConnected(false);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
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
          apiKey: clearApiKey ? null : apiKey || undefined,
          customHeaders: config.provider === "openai_compatible" ? headers : [],
        }),
      });
      const body = await response.json().catch(() => null) as { config?: PublicAiConfig; error?: { message?: string; details?: { formErrors?: string[] } } } | null;
      if (!response.ok || !body?.config) {
        const details = body?.error?.details?.formErrors?.join(" ");
        setMessage({ kind: "bad", text: details || body?.error?.message || `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setConfig(body.config);
      setApiKey("");
      setClearApiKey(false);
      setHeaders(body.config.customHeaders.map((header) => ({ ...header, value: "" })));
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
    if (announceSuccess) setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/ai-config/test", { method: "POST" });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
      const connectionSucceeded = response.ok && body?.ok;
      setConnected(Boolean(connectionSucceeded));
      if (connectionSucceeded) {
        if (announceSuccess) setMessage({ kind: "ok", text: "AI 연결에 성공했습니다." });
      } else {
        setMessage({ kind: "bad", text: body?.error?.message || `연결하지 못했습니다 (${response.status}).` });
      }
      return Boolean(connectionSucceeded);
    } catch {
      setMessage({ kind: "bad", text: "AI 서버에 연결하지 못했습니다." });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function testConnection() {
    if (testing || dirty) return;
    await verifyConnection(true);
  }

  return (
    <section aria-labelledby="ai-settings-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="ai-settings-heading" className="text-base font-semibold text-ink">AI 연결</h2>
        <HelpTip text="챗봇은 관련 공개 용어를, 자동 검토는 정리 대기 용어의 내용을 설정한 AI 서버로 보냅니다. 연결 정보는 관리자만 변경할 수 있습니다." />
        {connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/35 bg-ok-soft px-2.5 py-1 text-[11px] font-semibold text-ok" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
            Connected
          </span>
        )}
      </div>

      {!config.encryptionReady && (
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
                {!models.some((model) => model.id === config.model) && <option value={config.model}>{config.model} · 현재 입력값</option>}
                {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            ) : (
              <input id="ai-model" name="aiModel" autoComplete="off" value={config.model} onChange={(event) => update("model", event.target.value)} disabled={saving} placeholder="API 키를 입력하면 모델 목록을 불러옵니다…" className="field" />
            )}
            {modelError && <p className="mt-1 text-[11px] leading-4 text-danger" role="alert">{modelError} 직접 입력한 모델 이름은 그대로 저장할 수 있습니다.</p>}
          </div>
          <label className="block sm:col-span-2">
            <span className="label">API Base URL</span>
            <input name="aiBaseUrl" type="url" autoComplete="off" value={config.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} disabled={saving} placeholder="예: https://api.example.com/v1…" className="field font-mono text-xs" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label inline-flex items-center gap-1.5">API Key <HelpTip text="키를 입력하면 선택 가능한 모델을 자동으로 불러옵니다. 저장 후에는 값을 다시 표시하지 않으며, 빈 칸으로 저장하면 기존 키를 유지합니다." /></span>
            <div className="flex gap-2">
              <input name="aiApiKey" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); setDirty(true); setConnected(false); }} disabled={saving || clearApiKey} placeholder={config.hasApiKey ? "저장된 키 유지…" : "API Key…"} className="field min-w-0 flex-1 font-mono" />
              {config.hasApiKey && <button type="button" className={cx("btn-sm", clearApiKey ? "btn-danger" : "btn-ghost")} onClick={() => { setClearApiKey((value) => !value); setDirty(true); setConnected(false); }} disabled={saving}>{clearApiKey ? "제거 예정" : "키 제거"}</button>}
            </div>
          </label>
        </div>

        {config.provider === "openai_compatible" && (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium text-ink">Custom headers</h3>
              <HelpTip text="Authorization, api-key, 조직 식별자처럼 공급자가 요구하는 값을 추가합니다. 위험한 전송·프록시 header는 저장할 수 없습니다." />
              <button type="button" className="btn-ghost btn-sm ml-auto" disabled={saving || headers.length >= 20} onClick={() => { setHeaders((current) => [...current, { name: "", value: "" }]); setDirty(true); setConnected(false); }}>+ Header</button>
            </div>
            {headers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">추가 header가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {headers.map((header, index) => (
                  <div key={`${index}:${header.name}`} className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(10rem,1fr)_auto] gap-2">
                    <label className="sr-only" htmlFor={`ai-header-name-${index}`}>Header {index + 1} 이름</label>
                    <input id={`ai-header-name-${index}`} autoComplete="off" value={header.name} onChange={(event) => updateHeader(index, "name", event.target.value)} disabled={saving} placeholder="예: X-Organization…" className="field h-9 font-mono text-xs" />
                    <label className="sr-only" htmlFor={`ai-header-value-${index}`}>Header {index + 1} 값</label>
                    <input id={`ai-header-value-${index}`} type="password" autoComplete="new-password" value={header.value} onChange={(event) => updateHeader(index, "value", event.target.value)} disabled={saving} placeholder={header.configured ? "저장된 값 유지…" : "Header 값…"} className="field h-9 font-mono text-xs" />
                    <button type="button" aria-label={`${header.name || `Header ${index + 1}`} 제거`} className="btn-quiet h-9 w-9 p-0" disabled={saving} onClick={() => { setHeaders((current) => current.filter((_, itemIndex) => itemIndex !== index)); setDirty(true); setConnected(false); }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-12 flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2/50 px-4 py-2.5">
          {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mr-auto text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
          <button type="button" className="btn-ghost btn-sm" onClick={() => void testConnection()} disabled={saving || testing || dirty || !config.secretsReadable}>{testing ? "연결 확인 중…" : "연결 테스트"}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "저장 중…" : "AI 연결 저장"}</button>
        </div>
      </div>
    </section>
  );
}
