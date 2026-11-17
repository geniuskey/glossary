import type { TermTeachingBatch, TermTeachingDraft } from "./teaching-values";
import type { ChatEditProposal } from "./chat-edit-values";
import type { GroundedChatAnswer } from "./grounding-values";
import type { MeetingAnalysis } from "./meeting-values";
import type { DiscoveryReport } from "@/lib/discovery/ideas";
import type { ChatTraceStep } from "./chat-trace-values";

export interface StoredChatSource {
  termId?: string;
  slug: string;
  title: string;
  definition: string | null;
  status: "draft" | "active";
  revision?: number;
  updatedAt?: string;
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
  edit?: ChatEditProposal;
  grounded?: GroundedChatAnswer;
  meeting?: MeetingAnalysis;
  discovery?: DiscoveryReport;
  /** 서버가 만든 작업 단계. PATCH로 덮어쓸 수 없다. */
  trace?: ChatTraceStep[];
  searchDomain?: string | null;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatHistoryResponse {
  domains?: string[];
  sessions: ChatConversationSummary[];
  conversation: ({ id: string; title: string; messages: StoredChatMessage[] } & Pick<ChatConversationSummary, "createdAt" | "updatedAt">) | null;
}
