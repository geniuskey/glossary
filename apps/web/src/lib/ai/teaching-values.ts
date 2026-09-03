export interface TermTeachingDraft {
  nameEn: string | null;
  nameKo: string | null;
  fullNameEn: string | null;
  fullNameKo: string | null;
  definitionMd: string | null;
  bodyMd: string | null;
  skipped: {
    fullName: boolean;
    definition: boolean;
    body: boolean;
  };
}

export interface TermTeachingBatch {
  drafts: TermTeachingDraft[];
}

export type TeachingField = "fullName" | "definition" | "body";

export function teachingDraftName(draft: TermTeachingDraft): string {
  return draft.nameKo || draft.nameEn || "새 용어";
}

export function missingTeachingFields(draft: TermTeachingDraft): TeachingField[] {
  const missing: TeachingField[] = [];
  if (!draft.fullNameEn && !draft.fullNameKo && !draft.skipped.fullName) missing.push("fullName");
  if (!draft.definitionMd && !draft.skipped.definition) missing.push("definition");
  if (!draft.bodyMd && !draft.skipped.body) missing.push("body");
  // 아무 의미 정보 없이 이름만 등록하는 초안은 만들지 않는다.
  if (!draft.fullNameEn && !draft.fullNameKo && !draft.definitionMd && !draft.bodyMd && !missing.includes("definition")) {
    missing.push("definition");
  }
  return missing;
}

export function teachingDraftHasMeaning(draft: TermTeachingDraft): boolean {
  return Boolean(draft.fullNameEn || draft.fullNameKo || draft.definitionMd || draft.bodyMd);
}
