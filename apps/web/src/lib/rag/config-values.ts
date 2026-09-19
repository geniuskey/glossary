import type { RAG_VECTOR_DIMENSIONS } from "@glossary/db";

export const RAG_EMBEDDING_PROVIDERS = ["openai_compatible", "gemini"] as const;
export type RagEmbeddingProvider = (typeof RAG_EMBEDDING_PROVIDERS)[number];

export const RAG_EMBEDDING_PROVIDER_LABEL: Record<RagEmbeddingProvider, string> = {
  openai_compatible: "OpenAI Compatible",
  gemini: "Gemini Embedding API",
};

export const RAG_RERANKER_PROVIDERS = ["cohere_compatible", "openai_compatible"] as const;
export type RagRerankerProvider = (typeof RAG_RERANKER_PROVIDERS)[number];

export const RAG_RERANKER_PROVIDER_LABEL: Record<RagRerankerProvider, string> = {
  cohere_compatible: "Cohere-compatible",
  openai_compatible: "OpenAI Compatible",
};

export interface RagHeaderInput {
  name: string;
  value: string;
  configured?: boolean;
}

export interface PublicRagEndpointConfig {
  provider: RagEmbeddingProvider | RagRerankerProvider;
  baseUrl: string;
  model: string;
  dimensions?: typeof RAG_VECTOR_DIMENSIONS;
  hasApiKey: boolean;
  customHeaders: Array<{ name: string; configured: boolean }>;
  secretsReadable: boolean;
}

export interface PublicRagConfig {
  enabled: boolean;
  chatEnabled: boolean;
  embedding: PublicRagEndpointConfig & { provider: RagEmbeddingProvider; dimensions: typeof RAG_VECTOR_DIMENSIONS };
  reranker: PublicRagEndpointConfig & { provider: RagRerankerProvider; enabled: boolean };
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  encryptionReady: boolean;
  secretsReadable: boolean;
  stats: RagIndexStats;
}

export interface RagIndexStats {
  totalTerms: number;
  indexedTerms: number;
  indexedChunks: number;
  totalMeetings: number;
  indexedMeetings: number;
  meetingIndexedChunks: number;
  queued: number;
  processing: number;
  ready: number;
  failed: number;
  lastIndexedAt: string | null;
}
