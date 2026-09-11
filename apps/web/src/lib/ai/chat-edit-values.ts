import type { TermInput } from "@/lib/terms/schema";
export type ChatEditPatch = Partial<Pick<TermInput, "nameEn" | "nameKo" | "fullNameEn" | "fullNameKo" | "definitionMd" | "bodyMd" | "domain" | "category" | "topic" | "surfaces">>;
export interface ChatEditProposal {
  id: string;
  termId: string;
  slug: string;
  title: string;
  expectedRevision: number;
  before: ChatEditPatch;
  patch: ChatEditPatch;
  reason: string;
  status: "pending" | "applied" | "cancelled";
  appliedRevision?: number;
}

export const EDIT_FIELD_LABELS: Record<keyof ChatEditPatch, string> = {
  nameEn: "영문 표기", nameKo: "국문 표기", fullNameEn: "영문 확장명", fullNameKo: "국문 확장명",
  definitionMd: "한줄 정의", bodyMd: "상세 설명", domain: "도메인", category: "업무 분류", topic: "주제", surfaces: "추가 표기",
};

export function editValueText(value: unknown): string {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "(없음)";
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : `${item.text} (${item.kind})`).join("\n");
  return String(value);
}
