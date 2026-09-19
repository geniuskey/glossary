export interface ChatEvidence {
  id: string;
  termId?: string;
  slug: string;
  title: string;
  revision: number;
  updatedAt: string;
  field: "metadata" | "definition" | "body" | "relationship" | "meeting" | "wiki";
  excerpt: string;
  start?: number;
  source?: "glossary" | "meeting" | "wiki";
  meetingDocumentId?: string;
  meetingDate?: string | null;
  wikiPageId?: string;
  wikiSlug?: string;
  relatedTerm?: { termId?: string; slug: string; title: string; revision: number };
}

export interface GroundedInsight {
  title: string;
  text: string;
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
  discussionQuestion: string | null;
}

export interface GroundedChatAnswer {
  claims: Array<{ text: string; evidenceIds: string[] }>;
  insights: GroundedInsight[];
  uncertainties: string[];
  evidence: ChatEvidence[];
  searchedQueries: string[];
  domain: string | null;
}

export const EVIDENCE_FIELD_LABELS: Record<ChatEvidence["field"], string> = {
  metadata: "표기·분류", definition: "정의", body: "본문", relationship: "승인된 관계", meeting: "회의록", wiki: "위키",
};
