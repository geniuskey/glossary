"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HelpTip } from "@/components/help-tip";
import {
  RAG_EMBEDDING_PROVIDERS,
  RAG_EMBEDDING_PROVIDER_LABEL,
  RAG_RERANKER_PROVIDERS,
  RAG_RERANKER_PROVIDER_LABEL,
  type PublicRagConfig,
  type RagEmbeddingProvider,
  type RagRerankerProvider,
} from "@/lib/rag/config-values";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";
import { headerDraftsOf, headerPayload, newHeaderDraft, type HeaderDraft } from "@/lib/admin/header-drafts";
import { AdminPanelHeader, AdminSaveBar, StatusBadge } from "./admin-ui";

interface ModelOption { id: string; label: string }
interface ModelState { models: ModelOption[]; loading: boolean; error: string | null }

const EMPTY_MODEL_STATE: ModelState = { models: [], loading: false, error: null };

function headersOf(value: PublicRagConfig["embedding"] | PublicRagConfig["reranker"]): HeaderDraft[] {
  return headerDraftsOf(value.customHeaders);
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
  const [refreshingStats, setRefreshingStats] = useState(false);
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
      headers: headerPayload(embeddingHeaders),
    },
    reranker: {
      provider: config.reranker.provider,
      baseUrl: rerankerBaseUrl,
      apiKey: rerankerApiKey,
      clearApiKey: clearRerankerApiKey,
      hasApiKey: config.reranker.hasApiKey,
      headers: headerPayload(rerankerHeaders),
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
    // 행 id는 화면 전용이라 비교에서 뺀다. 넣으면 저장 직후에도 늘 "변경됨"이 된다.
    embeddingHeaders: headerPayload(embeddingHeaders),
    rerankerHeaders: headerPayload(rerankerHeaders),
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
    embeddingHeaders: headerPayload(headersOf(savedConfig.embedding)),
    rerankerHeaders: headerPayload(headersOf(savedConfig.reranker)),
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
          customHeaders: headerPayload(headers),
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
  }, [modelConnectionFingerprint, embeddingCanLoadModels, rerankerCanLoadModels, embeddingHasConnectionInput, rerankerHasConnectionInput]);

  // 대기열이 남아 있는 동안만 현황을 다시 읽는다. 재색인을 눌러 놓고 숫자가
  // 그대로면 작업이 도는지 멈췄는지 화면에서 알 수 없다.
  const indexingActive = config.stats.queued > 0;
  useEffect(() => {
    if (!indexingActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStats();
    }, 30_000);
    return () => window.clearInterval(timer);
  // refreshStats는 매 렌더 새로 만들어지지만 하는 일은 같다.
  }, [indexingActive]);

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
          embeddingCustomHeaders: headerPayload(embeddingHeaders),
          rerankerEnabled: config.reranker.enabled,
          rerankerProvider: config.reranker.provider,
          rerankerBaseUrl,
          rerankerModel: config.reranker.model,
          rerankerApiKey: clearRerankerApiKey ? null : rerankerApiKey || undefined,
          rerankerCustomHeaders: headerPayload(rerankerHeaders),
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

  function reset() {
    setConfig(savedConfig);
    setEmbeddingApiKey("");
    setRerankerApiKey("");
    setClearEmbeddingApiKey(false);
    setClearRerankerApiKey(false);
    setEmbeddingHeaders(headersOf(savedConfig.embedding));
    setRerankerHeaders(headersOf(savedConfig.reranker));
    setMessage(null);
  }

  async function refreshStats() {
    if (refreshingStats) return;
    setRefreshingStats(true);
    try {
      const response = await fetch("/api/v1/admin/rag-config", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { config?: PublicRagConfig } | null;
      if (!response.ok || !body?.config) return;
      // 통계만 갈아 끼운다. 설정값까지 바꾸면 작성 중인 변경이 사라진다.
      const stats = body.config.stats;
      setConfig((current) => ({ ...current, stats }));
      setSavedConfig((current) => ({ ...current, stats }));
    } finally {
      setRefreshingStats(false);
    }
  }

  async function reindex() {
    if (reindexing || dirty) return;
    const total = config.stats.totalTerms + config.stats.totalMeetings + config.stats.totalWikiPages;
    if (!window.confirm(`용어·회의록·위키 ${total.toLocaleString("ko-KR")}건을 모두 다시 색인할까요?\n모든 문서가 Embedding API로 다시 전송되어 호출 비용이 들고, 끝날 때까지 시간이 걸립니다. 그동안 기존 색인으로 검색합니다.`)) return;
    setReindexing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/rag-config/reindex", { method: "POST" });
      const body = await response.json().catch(() => null) as { queued?: number; error?: { message?: string } } | null;
      if (!response.ok) {
        setMessage({ kind: "bad", text: body?.error?.message || `재색인을 시작하지 못했습니다 (${response.status}).` });
        return;
      }
      setMessage({ kind: "ok", text: `${(body?.queued ?? 0).toLocaleString("ko-KR")}개 용어를 재색인 대기열에 넣었습니다. 색인 현황은 30초마다 갱신됩니다.` });
      await refreshStats();
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 재색인을 시작하지 못했습니다." });
    } finally {
      setReindexing(false);
    }
  }

  return (
    <section aria-labelledby="rag-settings-heading">
      <AdminPanelHeader
        id="rag-settings-heading"
        title="검색 인프라"
        description="Embedding API로 용어집을 벡터화하고, 필요하면 Reranker로 검색 결과를 다시 정렬합니다. 용어를 저장하면 최신 리비전이 자동으로 색인 대기열에 들어갑니다."
        help={<HelpTip text="용어집 내용을 청크로 나누어 pgvector에 저장하고, 질문을 같은 Embedding 공간으로 변환해 검색합니다. API 키와 헤더 값은 관리자 화면에 다시 표시하지 않습니다." />}
        status={!savedConfig.enabled
          ? <StatusBadge tone="neutral">꺼짐</StatusBadge>
          : !savedConfig.secretsReadable
            ? <StatusBadge tone="danger">비밀값 확인 필요</StatusBadge>
            : config.stats.failed > 0
              ? <StatusBadge tone="warn">색인 실패 {config.stats.failed.toLocaleString("ko-KR")}건</StatusBadge>
              : <StatusBadge tone="ok">사용 중</StatusBadge>}
      />

      {!config.encryptionReady && <div className="note note-warn mb-3" role="alert"><code>GLOSSARY_ENCRYPTION_KEY</code>를 32자 이상 설정해야 API 키와 헤더 값을 저장할 수 있습니다.</div>}
      {!config.secretsReadable && <div className="note note-warn mb-3" role="alert">저장된 RAG 비밀값을 읽을 수 없습니다. 서버의 암호화 키가 변경되지 않았는지 확인해 주세요.</div>}

      <div className="space-y-4">
        <section className="card overflow-hidden" aria-labelledby="rag-index-heading">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h3 id="rag-index-heading" className="mr-auto text-sm font-semibold text-ink">색인 현황</h3>
            <button type="button" className="btn-quiet btn-sm" disabled={refreshingStats} onClick={() => void refreshStats()}>{refreshingStats ? "갱신 중…" : "현황 새로고침"}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={saving || testing || dirty || !config.secretsReadable} title={dirty ? "저장한 뒤 테스트할 수 있습니다" : undefined} onClick={() => void testConnection()}>{testing ? "연결 확인 중…" : "연결 테스트"}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={saving || reindexing || dirty || !config.enabled} title={dirty ? "저장한 뒤 재색인할 수 있습니다" : undefined} onClick={() => void reindex()}>{reindexing ? "대기열 생성 중…" : "전체 재색인"}</button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
            <IndexStat label="용어" value={`${config.stats.indexedTerms.toLocaleString("ko-KR")} / ${config.stats.totalTerms.toLocaleString("ko-KR")}`} hint={`청크 ${config.stats.indexedChunks.toLocaleString("ko-KR")}개`} />
            <IndexStat label="회의록" value={`${config.stats.indexedMeetings.toLocaleString("ko-KR")} / ${config.stats.totalMeetings.toLocaleString("ko-KR")}`} hint={`청크 ${config.stats.meetingIndexedChunks.toLocaleString("ko-KR")}개`} />
            <IndexStat label="위키" value={`${config.stats.indexedWikiPages.toLocaleString("ko-KR")} / ${config.stats.totalWikiPages.toLocaleString("ko-KR")}`} hint={`청크 ${config.stats.wikiIndexedChunks.toLocaleString("ko-KR")}개`} />
            <IndexStat label="대기" value={config.stats.queued.toLocaleString("ko-KR")} hint={indexingActive ? "색인 진행 중 · 30초마다 갱신" : "대기 없음"} />
            <IndexStat label="실패" value={config.stats.failed.toLocaleString("ko-KR")} hint={config.stats.failed > 0 ? "AI 운영에서 원인 확인" : "실패 없음"} tone={config.stats.failed > 0 ? "danger" : undefined} href={config.stats.failed > 0 ? "/admin?tab=observability" : undefined} />
          </dl>
        </section>

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

      </div>

      <AdminSaveBar dirty={dirty} saving={saving} message={message} saveLabel="검색 설정 저장" onSave={() => void save()} onReset={reset} />
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
      <div className="mb-1.5 flex items-center gap-2"><span className="label">추가 요청 헤더</span><button type="button" className="ml-auto text-xs font-medium text-brand hover:underline" disabled={disabled || headers.length >= 20} onClick={() => onChange([...headers, newHeaderDraft()])}>+ 헤더 추가</button></div>
      {headers.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-[11px] text-ink-3">추가 헤더 없음</p> : <div className="space-y-2">{headers.map((header, index) => <div key={header.id} className="grid grid-cols-[minmax(5rem,0.8fr)_minmax(6rem,1fr)_auto] gap-2"><input aria-label={`헤더 ${index + 1} 이름`} value={header.name} onChange={(event) => onChange(headers.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item))} disabled={disabled} className="field h-9 font-mono text-xs" placeholder="X-Team" autoComplete="off" /><input aria-label={`헤더 ${index + 1} 값`} type="password" value={header.value} onChange={(event) => onChange(headers.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item))} disabled={disabled} className="field h-9 font-mono text-xs" placeholder={header.configured ? "저장된 값 유지…" : "값"} autoComplete="new-password" /><button type="button" className="btn-quiet h-9 w-9 p-0" aria-label={`${header.name || `헤더 ${index + 1}`} 제거`} onClick={() => onChange(headers.filter((item) => item.id !== header.id))} disabled={disabled}>×</button></div>)}</div>}
    </div>
  );
}

function IndexStat({ label, value, hint, tone, href }: { label: string; value: string; hint: string; tone?: "danger"; href?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cx("mt-0.5 font-mono text-lg font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-ink")}>{value}</dd>
      <dd className="mt-0.5 text-[11px] text-ink-3">{href ? <Link href={href} className="text-brand hover:underline">{hint}</Link> : hint}</dd>
    </div>
  );
}

function NumberField({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className="block"><span className="label">{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="field font-mono" min={0} /><span className="mt-1 block text-[11px] text-ink-3">{hint}</span></label>;
}
