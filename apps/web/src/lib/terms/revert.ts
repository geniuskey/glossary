import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { termRevisions } from "@grossary/db";
import { getDb } from "@/lib/db";
import { BUSINESS_CATEGORIES, EXPLICIT_SURFACE_KINDS, SURFACE_LANGS, TERM_STATUSES, TERM_TYPES, type TermTypeLiteral } from "./enums";
import { pickExplicitSurfaces } from "./surfaces";
import { updateTerm, type TermUpdate, type UpdateTermResult } from "./update";
import { TERM_QUALITY_PROFILES } from "@/lib/workspace/term-quality-values";

/**
 * R130: 되돌리기는 삭제가 아니라 쓰기다 — 대상 리비전의 스냅샷을 지금 상태에
 * 덮어쓰는 새 리비전(max + 1)을 남긴다. 이력에서 리비전을 지우면 "누가 뭘
 * 고쳤는지"라는 이 기능의 존재 이유가 사라진다. 승인 워크플로우 없이 로그인한
 * 사람이면 누구나 고치는 개방 편집에서, 안전판은 승인 라벨이 아니라 이 되돌리기다.
 */
export type RevertResult = UpdateTermResult | { revisionNotFound: true };

// 스냅샷은 jsonb라 타입 보증이 전혀 없다. 컬럼이 추가되기 전(bodyMd 이전 등)에
// 쌓인 리비전은 키 자체가 없을 수 있어 전부 optional로 읽고, 있는 키만 patch에
// 싣는다 — 없는 키를 null로 채우면 "그때 없던 값"을 "그때 비어 있었다"로
// 왜곡한다.
const snapshotSurfaceSchema = z.object({
  text: z.string(),
  lang: z.enum(SURFACE_LANGS).catch("neutral"),
  // canonical은 파생 표기라 명시 표기 목록에 들어가면 안 되지만(enums.ts의
  // EXPLICIT_SURFACE_KINDS 주석), 스냅샷에는 파생분까지 저장돼 있다. 여기서는
  // 그대로 읽고 pickExplicitSurfaces가 걸러낸다.
  kind: z.enum(["canonical", ...EXPLICIT_SURFACE_KINDS]),
  caseSensitive: z.boolean().optional(),
});

const snapshotSchema = z.object({
  term: z.object({
    termType: z.string().optional(),
    qualityProfile: z.string().optional(),
    nameEn: z.string().nullable().optional(),
    nameKo: z.string().nullable().optional(),
    fullNameEn: z.string().nullable().optional(),
    fullNameKo: z.string().nullable().optional(),
    domain: z.array(z.string()).optional(),
    category: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    topic: z.string().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    // R130: 옛 리비전에는 지금은 사라진 approved가 들어 있다. 스냅샷은 일부러
    // 고쳐 쓰지 않으므로 읽는 쪽에서 현재의 active로 옮긴다. draft는 다시 정식
    // 상태가 되었으므로 TERM_STATUSES 검사에서 그대로 보존된다.
    status: z.string().optional(),
    definitionMd: z.string().nullable().optional(),
    bodyMd: z.string().nullable().optional(),
  }),
  surfaces: z.array(snapshotSurfaceSchema),
});

const LEGACY_STATUS: Record<string, (typeof TERM_STATUSES)[number]> = {
  approved: "active",
};

const LEGACY_TERM_TYPE: Record<string, TermTypeLiteral> = {
  term: "concept",
  abbreviation: "concept",
  project: "proper_name",
  product_id: "identifier",
  code: "identifier",
  unit: "unit",
};

function readTermType(raw: string | undefined): TermTypeLiteral | undefined {
  if (raw === undefined) return undefined;
  if ((TERM_TYPES as readonly string[]).includes(raw)) return raw as TermTypeLiteral;
  return LEGACY_TERM_TYPE[raw];
}

function readCategory(raw: string | string[] | null | undefined, oldType: string | undefined): string[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (raw === null) return [];
  if (raw && (!oldType || !LEGACY_TERM_TYPE[oldType] || (BUSINESS_CATEGORIES as readonly string[]).includes(raw))) return [raw];
  if (oldType === "project") return ["project"];
  if (oldType === "product_id") return ["product"];
  return undefined;
}

function readStatus(raw: string | undefined): (typeof TERM_STATUSES)[number] | undefined {
  if (raw === undefined) return undefined;
  if ((TERM_STATUSES as readonly string[]).includes(raw)) return raw as (typeof TERM_STATUSES)[number];
  return LEGACY_STATUS[raw];
}

/**
 * 스냅샷을 updateTerm이 받는 patch로 옮긴다.
 *
 * definitionMd/bodyMd만 `?? ""`로 접는다. TermInput에서 이 둘은
 * `z.string().optional()`이라 null을 표현할 수 없는데(이름 필드와 달리 R117의
 * nullable 처리를 받지 않았다), undefined로 두면 updateTerm이 "안 건드림"으로
 * 읽어서 되돌린 뒤에도 나중에 쓴 정의가 그대로 남는다 — 되돌리기가 조용히
 * 일부만 되돌리는 셈이다. 빈 문자열은 화면에서 null과 구분되지 않는다.
 */
function toPatch(snapshot: z.infer<typeof snapshotSchema>): TermUpdate {
  const t = snapshot.term;
  const termType = readTermType(t.termType);
  const category = readCategory(t.category, t.termType);
  const topic = t.topic !== undefined
    ? t.topic
    : typeof t.category === "string" && t.category && t.termType && LEGACY_TERM_TYPE[t.termType]
      && !(BUSINESS_CATEGORIES as readonly string[]).includes(t.category)
      ? t.category
      : undefined;
  const names = {
    termType: termType ?? "concept",
    nameEn: t.nameEn ?? null,
    nameKo: t.nameKo ?? null,
    fullNameEn: t.fullNameEn ?? null,
    fullNameKo: t.fullNameKo ?? null,
  };

  const explicit = pickExplicitSurfaces(names, snapshot.surfaces).map((s) => ({
    text: s.text,
    lang: s.lang,
    kind: s.kind,
    caseSensitive: s.caseSensitive,
  }));

  const status = readStatus(t.status);
  const qualityProfile = t.qualityProfile && (TERM_QUALITY_PROFILES as readonly string[]).includes(t.qualityProfile)
    ? t.qualityProfile as (typeof TERM_QUALITY_PROFILES)[number]
    : undefined;

  return {
    ...(termType !== undefined ? { termType } : {}),
    ...(qualityProfile !== undefined ? { qualityProfile } : {}),
    ...(t.nameEn !== undefined ? { nameEn: t.nameEn } : {}),
    ...(t.nameKo !== undefined ? { nameKo: t.nameKo } : {}),
    ...(t.fullNameEn !== undefined ? { fullNameEn: t.fullNameEn } : {}),
    ...(t.fullNameKo !== undefined ? { fullNameKo: t.fullNameKo } : {}),
    ...(t.domain !== undefined ? { domain: t.domain } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(topic !== undefined ? { topic } : {}),
    ...(t.ownerId !== undefined ? { ownerId: t.ownerId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(t.definitionMd !== undefined ? { definitionMd: t.definitionMd ?? "" } : {}),
    ...(t.bodyMd !== undefined ? { bodyMd: t.bodyMd ?? "" } : {}),
    // surfaces는 항상 싣는다(빈 배열이라도). undefined로 두면 대상 리비전 이후에
    // 추가된 명시 표기가 되돌린 뒤에도 살아남는다(update.ts의 R51/R110 규칙).
    surfaces: explicit,
  };
}

export async function revertTerm(
  termId: string,
  revisionNumber: number,
  authorId: string | null,
  expectedRevision?: number,
  authorKeyId: string | null = null,
): Promise<RevertResult> {
  const [row] = await getDb()
    .select({ snapshot: termRevisions.snapshot })
    .from(termRevisions)
    .where(and(eq(termRevisions.termId, termId), eq(termRevisions.revisionNumber, revisionNumber)))
    .limit(1);

  if (!row) return { revisionNotFound: true };

  const parsed = snapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) {
    return { invalid: true, issues: [`리비전 #${revisionNumber}의 스냅샷을 읽을 수 없습니다.`] };
  }

  return updateTerm(
    termId,
    toPatch(parsed.data),
    authorId,
    expectedRevision,
    authorKeyId,
    `#${revisionNumber}으로 되돌림`,
  );
}
