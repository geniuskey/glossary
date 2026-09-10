export interface ChatEvidence {
  id: string;
  termId?: string;
  slug: string;
  title: string;
  revision: number;
  updatedAt: string;
  field: "metadata" | "definition" | "body" | "relationship";
  excerpt: string;
  start?: number;
  relatedTerm?: { termId?: string; slug: string; title: string; revision: number };
}

export interface GroundedChatAnswer {
  claims: Array<{ text: string; evidenceIds: string[] }>;
  uncertainties: string[];
  evidence: ChatEvidence[];
  searchedQueries: string[];
  domain: string | null;
}

export const EVIDENCE_FIELD_LABELS: Record<ChatEvidence["field"], string> = {
  metadata: "표기·분류", definition: "정의", body: "본문", relationship: "승인된 관계",
};
