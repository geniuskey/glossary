import type { ChatEvidence } from "./grounding-values";
import type { StoredChatSource } from "./chat-history-values";

export interface MeetingInputEvidence {
  id: string;
  excerpt: string;
  start: number;
}

export interface MeetingCitation {
  id: string;
  source: "meeting" | "glossary" | "wiki";
  excerpt: string;
  start?: number;
  title?: string;
  meetingDocumentId?: string;
  meetingDate?: string | null;
  wikiPageId?: string;
  wikiSlug?: string;
  termId?: string;
  slug?: string;
  revision?: number;
  updatedAt?: string;
  field?: ChatEvidence["field"];
  images?: ChatEvidence["images"];
  relatedTerm?: ChatEvidence["relatedTerm"];
}

export interface MeetingEvidenceItem {
  text: string;
  evidenceIds: string[];
}

export interface MeetingActionItem extends MeetingEvidenceItem {
  owner: string | null;
  dueDate: string | null;
  status: "open" | "blocked" | "done" | "unclear";
}

export interface MeetingInsight extends MeetingEvidenceItem {
  kind: "observation" | "implication" | "risk" | "opportunity";
  title: string;
  confidence: "high" | "medium" | "low";
  discussionQuestion: string | null;
}

export interface MeetingTermMatch {
  slug: string;
  title: string;
  reason: string;
  evidenceIds: string[];
}

export interface MeetingTermCandidate {
  surface: string;
  context: string;
  reason: string;
  suggestedAction: "add" | "clarify" | "standardize" | "merge";
  existingTerm: { slug: string; title: string } | null;
  evidenceIds: string[];
}

export interface MeetingAnalysis {
  summary: MeetingEvidenceItem;
  topics: MeetingEvidenceItem[];
  decisions: MeetingEvidenceItem[];
  actionItems: MeetingActionItem[];
  risks: MeetingEvidenceItem[];
  openQuestions: MeetingEvidenceItem[];
  insights: MeetingInsight[];
  termMatches: MeetingTermMatch[];
  termCandidates: MeetingTermCandidate[];
  uncertainties: string[];
  evidence: MeetingCitation[];
  glossarySources: StoredChatSource[];
}
