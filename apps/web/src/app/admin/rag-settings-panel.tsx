"use client";

import { useEffect, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import {
  RAG_EMBEDDING_PROVIDERS,
  RAG_EMBEDDING_PROVIDER_LABEL,
  RAG_RERANKER_PROVIDERS,
  RAG_RERANKER_PROVIDER_LABEL,
  type PublicRagConfig,
  type RagEmbeddingProvider,
  type RagHeaderInput,
  type RagRerankerProvider,
} from "@/lib/rag/config-values";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";

interface HeaderDraft extends RagHeaderInput { configured?: boolean }
interface ModelOption { id: string; label: string }
interface ModelState { models: ModelOption[]; loading: boolean; error: string | null }

const EMPTY_MODEL_STATE: ModelState = { models: [], loading: false, error: null };

function headersOf(value: PublicRagConfig["embedding"] | PublicRagConfig["reranker"]): HeaderDraft[] {
  return value.customHeaders.map((header) => ({ ...header, value: "" }));
}

export function RagSettingsPanel({ initialConfig }: { initialConfig: PublicRagConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [rerankerApiKey, setRerankerApiKey] = useState("");
  const [clearEmbeddingApiKey, setClearEmbeddingApiKey] = useState(false);
  const [clearRerankerApiKey, setClearRerankerApiKey] = useState(false);
  const [embeddingHeaders, setEmbeddingHeaders] = useState<HeaderDraft[]>(() => headersOf(initialConfig.embedding));
  const [rerankerHeaders, setRerankerHeaders] = useState<HeaderDraft[]>(() => headersOf(initialConfig.reranker));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [modelState, setModelState] = useState<{ embedding: ModelState; reranker: ModelState }>({
    embedding: { ...EMPTY_MODEL_STATE },
    reranker: { ...EMPTY_MODEL_STATE },
  });
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const sharedOpenAiBaseUrl = config.embedding.provider === "openai_compatible"
    && config.reranker.provider === "openai_compatible";
  const rerankerBaseUrl = sharedOpenAiBaseUrl ? config.embedding.baseUrl : config.reranker.baseUrl;
  const embeddingHeadersReady = embeddingHeaders.every((header) => Boolean(
    header.name.trim() && (header.value || header.configured),
  ));
  const rerankerHeadersReady = rerankerHeaders.every((header) => Boolean(
    header.name.trim() && (header.value || header.configured),
  ));
  const embeddingCanLoadModels = config.embedding.provider === "openai_compatible"
    && Boolean(config.embedding.baseUrl.trim()) && config.secretsReadable && embeddingHeadersReady;
  const rerankerCanLoadModels = config.reranker.provider === "openai_compatible"
    && Boolean(rerankerBaseUrl.trim()) && config.secretsReadable && rerankerHeadersReady;
  const embeddingHasConnectionInput = Boolean(embeddingApiKey.trim()) || config.embedding.hasApiKey
    || embeddingHeaders.some((header) => Boolean(header.value || header.configured));
  const rerankerHasConnectionInput = Boolean(rerankerApiKey.trim()) || config.reranker.hasApiKey
    || rerankerHeaders.some((header) => Boolean(header.value || header.configured));
  const modelConnectionFingerprint = JSON.stringify({
    embedding: {
      provider: config.embedding.provider,
      baseUrl: config.embedding.baseUrl,
      apiKey: embeddingApiKey,
      clearApiKey: clearEmbeddingApiKey,
      hasApiKey: config.embedding.hasApiKey,
      headers: embeddingHeaders,
    },
    reranker: {
      provider: config.reranker.provider,
      baseUrl: rerankerBaseUrl,
      apiKey: rerankerApiKey,
      clearApiKey: clearRerankerApiKey,
      hasApiKey: config.reranker.hasApiKey,
      headers: rerankerHeaders,
    },
  });

  const draftFingerprint = JSON.stringify({
    enabled: config.enabled,
    chatEnabled: config.chatEnabled,
    embedding: config.embedding,
    reranker: config.reranker,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    topK: config.topK,
    embeddingApiKey,
    rerankerApiKey,
    clearEmbeddingApiKey,
    clearRerankerApiKey,
    embeddingHeaders,
    rerankerHeaders,
  });
  const savedFingerprint = JSON.stringify({
    enabled: savedConfig.enabled,
    chatEnabled: savedConfig.chatEnabled,
    embedding: savedConfig.embedding,
    reranker: savedConfig.reranker,
    chunkSize: savedConfig.chunkSize,
    chunkOverlap: savedConfig.chunkOverlap,
    topK: savedConfig.topK,
    embeddingApiKey: "",
    rerankerApiKey: "",
    clearEmbeddingApiKey: false,
    clearRerankerApiKey: false,
    embeddingHeaders: headersOf(savedConfig.embedding),
    rerankerHeaders: headersOf(savedConfig.reranker),
  });
  const dirty = draftFingerprint !== savedFingerprint;
  useUnsavedChanges(dirty);

  function updateConfig<K extends keyof Pick<PublicRagConfig, "enabled" | "chatEnabled" | "chunkSize" | "chunkOverlap" | "topK">>(key: K, value: PublicRagConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function updateEmbedding<K extends keyof Pick<PublicRagConfig["embedding"], "provider" | "baseUrl" | "model">>(key: K, value: PublicRagConfig["embedding"][K]) {
    setConfig((current) => ({ ...current, embedding: { ...current.embedding, [key]: value } }));
    setMessage(null);
  }

  function updateReranker<K extends keyof Pick<PublicRagConfig["reranker"], "enabled" | "provider" | "baseUrl" | "model">>(key: K, value: PublicRagConfig["reranker"][K]) {
    setConfig((current) => ({ ...current, reranker: { ...current.reranker, [key]: value } }));
    setMessage(null);
  }

  function updateSharedOpenAiBaseUrl(value: string) {
    setConfig((current) => ({
      ...current,
      embedding: { ...current.embedding, baseUrl: value },
      reranker: { ...current.reranker, baseUrl: value },
    }));
    setMessage(null);
  }

  function updateModelState(kind: "embedding" | "reranker", patch: Partial<ModelState>) {
    setModelState((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  }

  async function loadModels(kind: "embedding" | "reranker", signal?: AbortSignal) {
    const isEmbedding = kind === "embedding";
    const canLoad = isEmbedding ? embeddingCanLoadModels : rerankerCanLoadModels;
    if (!canLoad) return;
    const baseUrl = isEmbedding ? config.embedding.baseUrl : rerankerBaseUrl;
    const apiKey = isEmbedding ? embeddingApiKey : rerankerApiKey;
    const clearApiKey = isEmbedding ? clearEmbeddingApiKey : clearRerankerApiKey;
    const headers = isEmbedding ? embeddingHeaders : rerankerHeaders;
    updateModelState(kind, { loading: true, error: null });
    try {
      const response = await fetch("/api/v1/admin/rag-config/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: kind,
          provider: "openai_compatible",
          baseUrl,
          apiKey: clearApiKey ? null : apiKey || undefined,
          customHeaders: headers,
        }),
        signal,
      });
      const body = await response.json().catch(() => null) as { models?: ModelOption[]; error?: { message?: string } } | null;
      if (signal?.aborted) return;
      if (!response.ok || !body?.models) {
        updateModelState(kind, { models: [], error: body?.error?.message || `모델 목록을 불러오지 못했습니다 (${response.status}).` });
        return;
      }
      updateModelState(kind, {
        models: body.models,
        error: body.models.length > 0 ? null : `${kind === "embedding" ? "embed" : "reranker"} 키워드를 포함한 모델을 찾지 못했습니다.`,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        updateModelState(kind, { models: [], error: "모델 목록을 불러오지 못했습니다." });
      }
    } finally {
      if (!signal?.aborted) updateModelState(kind, { loading: false });
    }
  }

  useEffect(() => {
    setModelState({
      embedding: { ...EMPTY_MODEL_STATE },
      reranker: { ...EMPTY_MODEL_STATE },
    });
    const scheduled: Array<{ timer: number; controller: AbortController }> = [];
    const schedule = (kind: "embedding" | "reranker", shouldLoad: boolean) => {
      if (!shouldLoad) return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => void loadModels(kind, controller.signal), 650);
      scheduled.push({ timer, controller });
    };
    schedule("embedding", embeddingCanLoadModels && embeddingHasConnectionInput);
    schedule("reranker", rerankerCanLoadModels && rerankerHasConnectionInput);
    return () => {
      for (const item of scheduled) {
        window.clearTimeout(item.timer);
        item.controller.abort();
      }
    };
  // modelConnectionFingerprint intentionally captures the connection inputs used by loadModels.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelConnectionFingerprint, embeddingCanLoadModels, rerankerCanLoadModels, embeddingHasConnectionInput, rerankerHasConnectionInput]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/rag-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: config.enabled,
          chatEnabled: config.chatEnabled,
          embeddingProvider: config.embedding.provider,
          embeddingBaseUrl: config.embedding.baseUrl,
          embeddingModel: config.embedding.model,
          embeddingApiKey: clearEmbeddingApiKey ? null : embeddingApiKey || undefined,
          embeddingCustomHeaders: embeddingHeaders,
          rerankerEnabled: config.reranker.enabled,
          rerankerProvider: config.reranker.provider,
          rerankerBaseUrl,
          rerankerModel: config.reranker.model,
          rerankerApiKey: clearRerankerApiKey ? null : rerankerApiKey || undefined,
          rerankerCustomHeaders: rerankerHeaders,
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          topK: config.topK,
        }),
      });
      const body = await response.json().catch(() => null) as { config?: PublicRagConfig; queued?: number; queuedMeetings?: number; queuedWikiPages?: number; error?: { message?: string; details?: { formErrors?: string[] } } } | null;
      if (!response.ok || !body?.config) {
        setMessage({ kind: "bad", text: body?.error?.details?.formErrors?.join(" ") || body?.error?.message || `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setConfig(body.config);
      setSavedConfig(body.config);
      setEmbeddingApiKey("");
      setRerankerApiKey("");
      setClearEmbeddingApiKey(false);
      setClearRerankerApiKey(false);
      setEmbeddingHeaders(headersOf(body.config.embedding));
      setRerankerHeaders(headersOf(body.config.reranker));
      const queuedText = [
        body.queued ? `${body.queued.toLocaleString("ko-KR")}개 용어` : "",
        body.queuedMeetings ? `${body.queuedMeetings.toLocaleString("ko-KR")}개 회의록` : "",
        body.queuedWikiPages ? `${body.queuedWikiPages.toLocaleString("ko-KR")}개 위키` : "",
      ].filter(Boolean).join(", ");
      setMessage({ kind: "ok", text: `RAG 설정을 저장했습니다. ${queuedText ? `${queuedText}를 재색인 대기열에 넣었습니다.` : ""}`.trim() });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (testing || dirty) return;
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/rag-config/test", { method: "POST" });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
      setMessage(response.ok && body?.ok
        ? { kind: "ok", text: config.reranker.enabled ? "Embedding·Reranker 연결에 성공했습니다." : "Embedding API 연결에 성공했습니다." }
        : { kind: "bad", text: body?.error?.message || `연결하지 못했습니다 (${response.status}).` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 연결을 확인하지 못했습니다." });
    } finally {
      setTesting(false);
    }
  }

  async function reindex() {
    if (reindexing || dirty) return;
    setReindexing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/rag-config/reindex", { method: "POST" });
      const body = await response.json().catch(() => null) as { queued?: number; error?: { message?: string } } | null;
      if (!response.ok) {
        setMessage({ kind: "bad", text: body?.error?.message || `재색인을 시작하지 못했습니다 (${response.status}).` });
        return;
      }
      setMessage({ kind: "ok", text: `${(body?.queued ?? 0).toLocaleString("ko-KR")}개 용어를 재색인 대기열에 넣었습니다.` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 재색인을 시작하지 못했습니다." });
    } finally {
      setReindexing(false);
    }
  }

  return (
    <section aria-labelledby="rag-settings-heading">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <h2 id="rag-settings-heading" className="text-base font-semibold text-ink">검색 인프라</h2>
          <HelpTip text="용어집 내용을 청크로 나누어 pgvector에 저장하고, 질문을 같은 Embedding 공간으로 변환해 검색합니다. API 키와 header 값은 관리자 화면에 다시 표시하지 않습니다." />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">
          Embedding API로 용어집을 벡터화하고, 필요하면 Reranker로 검색 결과를 다시 정렬합니다. 용어를 저장하면 최신 리비전이 자동으로 색인 대기열에 들어갑니다.
        </p>
      </header>

      {!config.encryptionReady && <div className="note note-warn mb-3" role="alert"><code>GLOSSARY_ENCRYPTION_KEY</code>를 32자 이상 설정해야 API 키와 header 값을 저장할 수 있습니다.</div>}
      {!config.secretsReadable && <div className="note note-warn mb-3" role="alert">저장된 RAG 비밀값을 읽을 수 없습니다. 서버의 암호화 키가 변경되지 않았는지 확인해 주세요.</div>}

      <div className="space-y-4">
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-panel-2/50 px-4 py-3">
            <label className="flex min-h-10 items-center gap-3">
              <input type="checkbox" checked={config.enabled} onChange={(event) => updateConfig("enabled", event.target.checked)} disabled={saving} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="text-sm font-medium text-ink">RAG 검색 사용</span>
              <span className="ml-auto text-xs text-ink-3">저장된 용어를 벡터 검색 API로 제공</span>
            </label>
            <label className="mt-2 flex items-start gap-3 text-xs text-ink-2">
              <input type="checkbox" checked={config.chatEnabled} onChange={(event) => updateConfig("chatEnabled", event.target.checked)} disabled={saving || !config.enabled} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
              <span><span className="font-medium text-ink">챗봇의 하이브리드 검색 보조로 사용</span><span className="mt-0.5 block text-ink-3">활성화하면 챗봇 질문도 Embedding API로 전송되어 키워드 검색과 함께 검색합니다.</span></span>
            </label>
          </div>
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            {sharedOpenAiBaseUrl && (
              <div className="rounded-lg border border-brand/25 bg-brand/5 p-3 lg:col-span-2">
                <label className="block">
                  <span className="label inline-flex items-center gap-1.5">공용 OpenAI-compatible API Base URL <HelpTip text="Embedding은 /embeddings, Reranker는 /rerank, 모델 선택은 /models를 같은 /v1 서버에서 사용합니다." /></span>
                  <input type="url" value={config.embedding.baseUrl} onChange={(event) => updateSharedOpenAiBaseUrl(event.target.value)} disabled={saving} className="field font-mono text-xs" autoComplete="off" placeholder="예: https://ai.example.com/v1" />
                </label>
                <p className="mt-1.5 text-[11px] leading-4 text-ink-3">LLM은 AI 연결 탭의 Base URL에도 같은 주소를 사용하면 됩니다. 아래 Embedding·Reranker 주소 입력은 이 공용 주소로 함께 저장됩니다.</p>
              </div>
            )}
            <EndpointFields
              title="Embedding API"
              provider={config.embedding.provider}
              providers={RAG_EMBEDDING_PROVIDERS}
              providerLabels={RAG_EMBEDDING_PROVIDER_LABEL}
              baseUrl={config.embedding.baseUrl}
              model={config.embedding.model}
              dimensions={config.embedding.dimensions}
              apiKeyConfigured={config.embedding.hasApiKey}
              apiKey={embeddingApiKey}
              clearApiKey={clearEmbeddingApiKey}
              headers={embeddingHeaders}
              showBaseUrl={!sharedOpenAiBaseUrl}
              models={modelState.embedding.models}
              loadingModels={modelState.embedding.loading}
              modelError={modelState.embedding.error}
              canLoadModels={embeddingCanLoadModels}
              onLoadModels={() => void loadModels("embedding")}
              disabled={saving}
              onProviderChange={(value) => updateEmbedding("provider", value as RagEmbeddingProvider)}
              onBaseUrlChange={(value) => updateEmbedding("baseUrl", value)}
              onModelChange={(value) => updateEmbedding("model", value)}
              onApiKeyChange={(value) => { setEmbeddingApiKey(value); setClearEmbeddingApiKey(false); setMessage(null); }}
              onClearApiKey={() => setClearEmbeddingApiKey((value) => !value)}
              onHeadersChange={(value) => { setEmbeddingHeaders(value); setMessage(null); }}
            />
            <EndpointFields
              title="Reranker API"
              enabled={config.reranker.enabled}
              provider={config.reranker.provider}
              providers={RAG_RERANKER_PROVIDERS}
              providerLabels={RAG_RERANKER_PROVIDER_LABEL}
              baseUrl={rerankerBaseUrl}
              model={config.reranker.model}
              apiKeyConfigured={config.reranker.hasApiKey}
              apiKey={rerankerApiKey}
              clearApiKey={clearRerankerApiKey}
              headers={rerankerHeaders}
              models={modelState.reranker.models}
              loadingModels={modelState.reranker.loading}
              modelError={modelState.reranker.error}
              canLoadModels={rerankerCanLoadModels}
              onLoadModels={() => void loadModels("reranker")}
              showBaseUrl={!sharedOpenAiBaseUrl}
              disabled={saving}
              onEnabledChange={(value) => updateReranker("enabled", value)}
              onProviderChange={(value) => updateReranker("provider", value as RagRerankerProvider)}
              onBaseUrlChange={(value) => updateReranker("baseUrl", value)}
              onModelChange={(value) => updateReranker("model", value)}
              onApiKeyChange={(value) => { setRerankerApiKey(value); setClearRerankerApiKey(false); setMessage(null); }}
              onClearApiKey={() => setClearRerankerApiKey((value) => !value)}
              onHeadersChange={(value) => { setRerankerHeaders(value); setMessage(null); }}
            />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">청크와 검색 기본값</h3></div>
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <NumberField label="청크 크기" hint="400~8000자" value={config.chunkSize} onChange={(value) => updateConfig("chunkSize", value)} disabled={saving} />
            <NumberField label="청크 겹침" hint="앞 청크와 겹칠 문자 수" value={config.chunkOverlap} onChange={(value) => updateConfig("chunkOverlap", value)} disabled={saving} />
            <NumberField label="기본 결과 수" hint="1~50개" value={config.topK} onChange={(value) => updateConfig("topK", value)} disabled={saving} />
          </div>
          <p className="border-t border-line px-4 py-3 text-xs leading-5 text-ink-3">현재 벡터 차원은 {config.embedding.dimensions.toLocaleString("ko-KR")}개로 고정되어 있습니다. OpenAI text-embedding-3 계열은 dimensions를, Gemini는 outputDimensionality를 이 값으로 요청합니다.</p>
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-line bg-panel-2/50 px-4 py-3">
            <div><p className="text-xs text-ink-3">현재 용어 색인</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{config.stats.indexedTerms.toLocaleString("ko-KR")} / {config.stats.totalTerms.toLocaleString("ko-KR")}개</p></div>
            <div><p className="text-xs text-ink-3">회의록 색인</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{config.stats.indexedMeetings.toLocaleString("ko-KR")} / {config.stats.totalMeetings.toLocaleString("ko-KR")}개</p></div>
            <div><p className="text-xs text-ink-3">위키 색인</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{config.stats.indexedWikiPages.toLocaleString("ko-KR")} / {config.stats.totalWikiPages.toLocaleString("ko-KR")}개</p></div>
            <div className="text-xs leading-5 text-ink-2">용어 청크 {config.stats.indexedChunks.toLocaleString("ko-KR")}개 · 회의록 청크 {config.stats.meetingIndexedChunks.toLocaleString("ko-KR")}개 · 위키 청크 {config.stats.wikiIndexedChunks.toLocaleString("ko-KR")}개 · 대기 {config.stats.queued.toLocaleString("ko-KR")}개 · 실패 {config.stats.failed.toLocaleString("ko-KR")}개</div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className="btn-ghost btn-sm" disabled={saving || testing || dirty || !config.secretsReadable} onClick={() => void testConnection()}>{testing ? "연결 확인 중…" : "연결 테스트"}</button>
              <button type="button" className="btn-ghost btn-sm" disabled={saving || reindexing || dirty || !config.enabled} onClick={() => void reindex()}>{reindexing ? "대기열 생성 중…" : "전체 재색인"}</button>
            </div>
          </div>
          <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2.5">
            {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mr-auto text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
            {!message && <span className="mr-auto text-xs text-ink-3">{dirty ? "저장하지 않은 변경사항" : "저장된 설정과 같습니다"}</span>}
            <button type="button" className="btn-primary btn-sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "저장 중…" : "RAG 설정 저장"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EndpointFields({
  title,
  enabled,
  provider,
  providers,
  providerLabels,
  baseUrl,
  model,
  dimensions,
  apiKeyConfigured,
  apiKey,
  clearApiKey,
  headers,
  models,
  loadingModels,
  modelError,
  canLoadModels,
  onLoadModels,
  showBaseUrl,
  disabled,
  onEnabledChange,
  onProviderChange,
  onBaseUrlChange,
  onModelChange,
  onApiKeyChange,
  onClearApiKey,
  onHeadersChange,
}: {
  title: string;
  enabled?: boolean;
  provider: string;
  providers: readonly string[];
  providerLabels: Record<string, string>;
  baseUrl: string;
  model: string;
  dimensions?: number;
  apiKeyConfigured: boolean;
  apiKey: string;
  clearApiKey: boolean;
  headers: HeaderDraft[];
  models: ModelOption[];
  loadingModels: boolean;
  modelError: string | null;
  canLoadModels: boolean;
  onLoadModels: () => void;
  showBaseUrl?: boolean;
  disabled: boolean;
  onEnabledChange?: (value: boolean) => void;
  onProviderChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onClearApiKey: () => void;
  onHeadersChange: (value: HeaderDraft[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink">{title}</h3>{title === "Embedding API" && <HelpTip text="OpenAI-compatible /embeddings 또는 Gemini batchEmbedContents 응답을 지원합니다." />}{title === "Reranker API" && provider === "openai_compatible" && <HelpTip text="OpenAI-compatible /v1/rerank 요청과 /v1/models 모델 선택을 지원합니다." />}</div>
      {onEnabledChange && <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} disabled={disabled} className="h-4 w-4 accent-[var(--brand)]" />Reranker 사용</label>}
      <label className="block"><span className="label">공급자</span><select value={provider} onChange={(event) => onProviderChange(event.target.value)} disabled={disabled} className="field">{providers.map((item) => <option key={item} value={item}>{providerLabels[item] ?? item}</option>)}</select></label>
      <div className="block">
        <span className="label flex items-center gap-2">
          <label htmlFor={`${title === "Embedding API" ? "embedding" : "reranker"}-model`}>모델</label>
          {loadingModels && <span className="ml-auto font-normal text-ink-3" role="status">목록 불러오는 중…</span>}
          {!loadingModels && canLoadModels && <button type="button" className="ml-auto font-normal text-brand hover:underline" onClick={onLoadModels} disabled={disabled}>새로고침</button>}
        </span>
        {models.length > 0 ? (
          <select id={`${title === "Embedding API" ? "embedding" : "reranker"}-model`} value={model} onChange={(event) => onModelChange(event.target.value)} disabled={disabled || loadingModels} className="field">
            {!model && <option value="">모델 선택…</option>}
            {!models.some((item) => item.id === model) && model && <option value={model}>{model} · 현재 입력값</option>}
            {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        ) : (
          <input id={`${title === "Embedding API" ? "embedding" : "reranker"}-model`} value={model} onChange={(event) => onModelChange(event.target.value)} disabled={disabled} className="field" autoComplete="off" placeholder={provider === "openai_compatible" ? "API 서버에서 모델 목록을 불러옵니다…" : undefined} />
        )}
        {modelError && <p className="mt-1 text-[11px] leading-4 text-danger" role="alert">{modelError} 직접 입력한 모델 이름은 그대로 저장할 수 있습니다.</p>}
        {dimensions && <span className="mt-1 block text-[11px] text-ink-3">출력 차원: {dimensions}</span>}
      </div>
      {showBaseUrl !== false && <label className="block"><span className="label">API Base URL</span><input type="url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} disabled={disabled} className="field font-mono text-xs" autoComplete="off" /></label>}
      <label className="block"><span className="label">API Key</span><div className="flex gap-2"><input type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} disabled={disabled || clearApiKey} placeholder={apiKeyConfigured ? "저장된 키 유지…" : "API Key…"} className="field min-w-0 flex-1 font-mono" autoComplete="new-password" />{apiKeyConfigured && <button type="button" className={cx("btn-sm", clearApiKey ? "btn-danger" : "btn-ghost")} onClick={onClearApiKey} disabled={disabled}>{clearApiKey ? "제거 예정" : "키 제거"}</button>}</div></label>
      <HeaderEditor headers={headers} disabled={disabled} onChange={onHeadersChange} />
    </div>
  );
}

function HeaderEditor({ headers, disabled, onChange }: { headers: HeaderDraft[]; disabled: boolean; onChange: (value: HeaderDraft[]) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2"><span className="label">Custom headers</span><button type="button" className="ml-auto text-xs font-medium text-brand hover:underline" disabled={disabled || headers.length >= 20} onClick={() => onChange([...headers, { name: "", value: "" }])}>+ 추가</button></div>
      {headers.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-[11px] text-ink-3">추가 header 없음</p> : <div className="space-y-2">{headers.map((header, index) => <div key={`${index}:${header.name}`} className="grid grid-cols-[minmax(5rem,0.8fr)_minmax(6rem,1fr)_auto] gap-2"><input aria-label={`Header ${index + 1} 이름`} value={header.name} onChange={(event) => onChange(headers.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} disabled={disabled} className="field h-9 font-mono text-xs" placeholder="X-Team" autoComplete="off" /><input aria-label={`Header ${index + 1} 값`} type="password" value={header.value} onChange={(event) => onChange(headers.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} disabled={disabled} className="field h-9 font-mono text-xs" placeholder={header.configured ? "저장된 값 유지…" : "값"} autoComplete="new-password" /><button type="button" className="btn-quiet h-9 w-9 p-0" aria-label={`${header.name || `Header ${index + 1}`} 제거`} onClick={() => onChange(headers.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled}>×</button></div>)}</div>}
    </div>
  );
}

function NumberField({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className="block"><span className="label">{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="field font-mono" min={0} /><span className="mt-1 block text-[11px] text-ink-3">{hint}</span></label>;
}
