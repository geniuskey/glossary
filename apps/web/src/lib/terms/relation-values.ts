export const RELATION_TYPES = ["related_to", "is_a", "part_of", "used_in", "prerequisite_of", "replaces"] as const;
export type RelationType = typeof RELATION_TYPES[number];
export const RELATION_STATUS_LABEL = { proposed: "검토 대기", approved: "승인됨", rejected: "거절됨" } as const;
export type RelationStatus = keyof typeof RELATION_STATUS_LABEL;
export const RELATION_LABEL: Record<RelationType, string> = {
  related_to: "관련됨", is_a: "하위 종류임", part_of: "일부임", used_in: "사용됨", prerequisite_of: "선행 조건임", replaces: "대체함",
};
export const RELATION_HELP: Record<RelationType, string> = {
  related_to: "A와 B가 관련되어 있습니다. 상하위·부분 관계를 확정할 수 없을 때 사용합니다.",
  is_a: "A는 B의 하위 종류입니다. 예: 이미지 센서 → 센서",
  part_of: "A는 B를 구성하는 일부입니다. 예: 이미지 센서 → 카메라 모듈",
  used_in: "A는 B에서 사용됩니다. 예: 측정 장비 → 검사 공정",
  prerequisite_of: "A는 B에 앞서 충족해야 하는 조건입니다. 예: 보정 → 측정",
  replaces: "A가 B를 대체합니다. 새 개념에서 이전 개념을 향합니다.",
};

export interface RelationTerm {
  id: string;
  slug: string;
  name: string;
  definition: string | null;
  domain: string[];
  revision: number;
}

export interface SemanticRelation {
  id: string;
  sourceTermId: string;
  targetTermId: string;
  relationType: RelationType;
  evidenceMd: string | null;
}

export interface ManagedRelation extends SemanticRelation {
  status: RelationStatus;
  confidence: number;
  sourceRevision: number | null;
  targetRevision: number | null;
  source: RelationTerm;
  target: RelationTerm;
  stale: boolean;
  version: string;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
}

export interface RelationPage { items: ManagedRelation[]; total: number; page: number }
