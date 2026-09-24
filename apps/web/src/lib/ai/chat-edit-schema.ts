import { termInputBaseSchema } from "@/lib/terms/schema";

export const chatEditPatchSchema = termInputBaseSchema.pick({
  nameEn: true, nameKo: true, fullNameEn: true, fullNameKo: true,
  definitionMd: true, bodyMd: true, domain: true, category: true, topic: true, tags: true, surfaces: true,
}).partial().strict().refine((value) => Object.keys(value).length > 0, "수정할 필드가 필요합니다.");
