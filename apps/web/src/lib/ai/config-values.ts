export const AI_PROVIDERS = ["gemini", "openai_compatible", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: "Gemini API",
  openai_compatible: "OpenAI Compatible",
  ollama: "Ollama",
};

export interface AiHeaderInput {
  name: string;
  value: string;
  configured?: boolean;
}

export interface PublicAiConfig {
  enabled: boolean;
  autoReviewEnabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  customHeaders: Array<{ name: string; configured: boolean }>;
  encryptionReady: boolean;
  secretsReadable: boolean;
}
