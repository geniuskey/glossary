import type { TermTeachingBatch, TermTeachingDraft } from "./teaching-values";

export interface StoredChatSource {
  slug: string;
  title: string;
  definition: string | null;
  status: "draft" | "active";
}

export interface StoredChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: StoredChatSource[];
  teaching?: { draft: TermTeachingDraft; ready: boolean };
  teachingBatch?: TermTeachingBatch;
  created?: Array<{ slug: string; title: string }>;
  failed?: boolean;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatHistoryResponse {
  sessions: ChatConversationSummary[];
  conversation: ({ id: string; title: string; messages: StoredChatMessage[] } & Pick<ChatConversationSummary, "createdAt" | "updatedAt">) | null;
}
