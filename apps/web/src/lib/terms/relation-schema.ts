import { z } from "zod/v3";
import { RELATION_TYPES } from "./relation-values";

const revision = z.number().int().positive();
const fields = {
  relationType: z.enum(RELATION_TYPES),
  evidenceMd: z.string().trim().min(1).max(4000),
  sourceRevision: revision,
  targetRevision: revision,
};
export const relationCreateSchema = z.object({ sourceTermId: z.string().uuid(), targetTermId: z.string().uuid(), ...fields }).strict()
  .refine((input) => input.sourceTermId !== input.targetTermId, { message: "서로 다른 용어를 선택해 주세요.", path: ["targetTermId"] });
const version = z.string().regex(/^\d+$/).max(20);
export const relationChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), version, ...fields }).strict(),
  z.object({ action: z.literal("approved"), version }).strict(),
  z.object({ action: z.literal("rejected"), version }).strict(),
]);
export const relationListSchema = z.object({
  termId: z.string().uuid().optional(),
  status: z.enum(["proposed", "approved", "rejected"]).optional(),
  type: z.enum(RELATION_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
