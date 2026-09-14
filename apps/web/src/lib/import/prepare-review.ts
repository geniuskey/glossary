import { z } from "zod/v3";
import { createHash } from "node:crypto";
import type { ImportRow, ParseResult } from "./parse-xlsx";
import { dryRunImport } from "./apply";
import { MAX_IMPORT_ROWS } from "./format";
import { termInputSchema, type TermInput } from "@/lib/terms/schema";
import { mergeContent } from "@/lib/terms/merge-values";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { currentRevisionNumber } from "@/lib/terms/update";
import type { ReviewRow } from "./review";
import { inferSurfaceLang } from "@/lib/terms/surface-language";
import { splitSurfaceCell, reviewFingerprint, type ReviewReport, type ReviewDecision, type SplitOptions } from "./review";

// Invalid term lengths belong to row errors, so the user can fix or skip that row.
const names = z.array(z.string().trim().min(1).max(100_000)).max(1000);
export const reviewRequestSchema = z.object({
  columns: z.array(z.enum(["domain", "definitionMd", "bodyMd"])).max(3).default([]),
  options: z.object({ comma: z.boolean(), semicolon: z.boolean(), newline: z.boolean() }),
  decisions: z.array(z.object({
    rowNumber: z.number().int().positive(), en: names, ko: names, skip: z.boolean(),
    approval: z.string().max(100_000).optional(),
    mergeIntoRow: z.number().int().positive().optional(),
    mergeIntoTerm: z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).optional(),
  })).max(MAX_IMPORT_ROWS),
});

export function reviewedInput(row: ImportRow) {
  return {
    nameEn: row.nameEn, nameKo: row.nameKo, fullNameEn: row.fullNameEn, fullNameKo: row.fullNameKo,
    domain: row.domain, category: row.category ? [row.category] : [], topic: row.topic, definitionMd: row.definitionMd, bodyMd: row.bodyMd,
    surfaces: [
      ...row.canonicalNames.map((text) => ({ text, kind: "canonical" as const })),
      ...row.abbreviations.map((text) => ({ text, kind: "abbreviation" as const })),
      ...row.aliases.map((text) => ({ text, kind: "alias" as const })),
      ...row.discouragedNames.map((text) => ({ text, kind: "discouraged" as const })),
      ...row.forbiddenNames.map((text) => ({ text, kind: "forbidden" as const })),
    ],
  };
}

export async function prepareReview(parsed: ParseResult, options: SplitOptions, decisions: ReviewDecision[]) {
  const byNumber = new Map(decisions.map((d) => [d.rowNumber, d]));
  if (byNumber.size !== decisions.length || decisions.some((d) => !parsed.rows.some((r) => r.rowNumber === d.rowNumber))) {
    throw new Error("검토 행 번호가 원본과 일치하지 않습니다.");
  }
  const mapped: ImportRow[] = [];
  const inputs = new Map<number, TermInput>();
  const report: ReviewReport = { rows: [], errors: parsed.errors, fileErrors: parsed.fileErrors, ignoredHeaders: parsed.ignoredHeaders };
  for (const source of parsed.rows) {
    const en = splitSurfaceCell(source.nameEn ?? "", options);
    const ko = splitSurfaceCell(source.nameKo ?? "", options);
    const decision = byNumber.get(source.rowNumber);
    const row: ReviewRow = {
      rowNumber: source.rowNumber, originalEn: source.nameEn ?? "", originalKo: source.nameKo ?? "",
      en: decision?.en ?? en.values, ko: decision?.ko ?? ko.values,
      skip: decision?.skip ?? false, approval: decision?.approval,
      mergeIntoRow: decision?.mergeIntoRow, mergeIntoTerm: decision?.mergeIntoTerm,
      domain: source.domain, definitionMd: source.definitionMd, bodyMd: source.bodyMd,
      reasons: [...new Set([...en.reasons, ...ko.reasons])], errors: [] as string[], fingerprint: "",
    };
    const converted: ImportRow = {
      ...source, nameEn: row.en[0], nameKo: row.ko[0],
      aliases: [...new Set([...source.aliases, ...row.en.slice(1), ...row.ko.slice(1)])],
    };
    const validation = termInputSchema.safeParse(reviewedInput(converted));
    if (!validation.success) row.errors = validation.error.issues.map((issue) => issue.message);
    if (!row.skip && validation.success) { mapped.push(converted); inputs.set(row.rowNumber, validation.data); }
    report.rows.push(row);
  }
  // No merge chains: every source points directly to a retained row.
  for (const row of report.rows.filter((r) => !r.skip && r.mergeIntoRow)) {
    const target = report.rows.find((r) => r.rowNumber === row.mergeIntoRow);
    const sourceInput = inputs.get(row.rowNumber), targetInput = target && inputs.get(target.rowNumber);
    if (!target || target === row || target.skip || target.mergeIntoRow || row.mergeIntoTerm || !sourceInput || !targetInput) {
      row.errors.push("병합 대상은 건너뛰지 않은 다른 대표 행이어야 합니다. 연속 병합은 대표 행을 직접 선택해 주세요."); continue;
    }
    const merged = termInputSchema.safeParse(mergeContent(targetInput, sourceInput));
    if (!merged.success) { row.errors.push(...merged.error.issues.map((i) => i.message)); continue; }
    inputs.set(target.rowNumber, merged.data); inputs.delete(row.rowNumber);
    row.reasons.push(`${target.rowNumber}행으로 합칩니다. 이 행은 별도로 등록하지 않습니다.`);
    target.reasons.push(`${row.rowNumber}행의 표기·정의·본문을 함께 보존합니다.`);
  }
  const targetIds = new Set<string>();
  for (const row of report.rows.filter((r) => !r.skip && r.mergeIntoTerm)) {
    const input = inputs.get(row.rowNumber), target = row.mergeIntoTerm!;
    if (!input || targetIds.has(target.id)) { row.errors.push("같은 기존 용어로 합칠 행은 먼저 파일 안에서 하나로 합쳐 주세요."); continue; }
    targetIds.add(target.id);
    const revision = await currentRevisionNumber(target.id);
    const existing = await getTermByIdOrSlug(target.id);
    if (!existing || revision !== target.revision || await currentRevisionNumber(target.id) !== revision) {
      row.errors.push("병합 대상이 변경되었습니다. AI 중복 검토를 다시 실행하고 대상을 선택해 주세요."); continue;
    }
    const merged = termInputSchema.safeParse(mergeContent({ ...existing, definitionMd: existing.definitionMd ?? "", bodyMd: existing.bodyMd ?? "", category: existing.categories,
      surfaces: existing.surfaces.map((s) => ({ ...s, lang: inferSurfaceLang(s.text) })) }, input));
    if (!merged.success) { row.errors.push(...merged.error.issues.map((i) => i.message)); continue; }
    inputs.set(row.rowNumber, { ...merged.data, qualityProfile: existing.qualityProfile });
    row.reasons.push(`기존 /${existing.slug} 용어로 합칩니다. 새 URL을 만들지 않습니다.`);
  }
  for (const row of report.rows) {
    const merged = inputs.get(row.rowNumber);
    if (merged && (row.mergeIntoTerm || report.rows.some((r) => !r.skip && r.mergeIntoRow === row.rowNumber))) {
      row.mergePreview = [`대표 표기: ${[merged.nameEn, merged.nameKo].filter(Boolean).join(" · ")}`,
        `한줄 정의: ${merged.definitionMd || "없음"}`, `도메인: ${merged.domain.join(" · ") || "없음"}`,
        `표기: ${merged.surfaces.map((s) => s.text).join(" · ")}`, `본문:\n${merged.bodyMd || "없음"}`].join("\n\n");
    }
  }
  const effective = mapped.filter((r) => inputs.has(r.rowNumber));
  const verdict = await dryRunImport(effective.map((r) => {
    const input = inputs.get(r.rowNumber)!;
    return { ...r, nameEn: input.nameEn ?? undefined, nameKo: input.nameKo ?? undefined,
      fullNameEn: input.fullNameEn ?? undefined, fullNameKo: input.fullNameKo ?? undefined,
      canonicalNames: input.surfaces.filter((s) => s.kind === "canonical" || s.kind === "full_name").map((s) => s.text),
      abbreviations: input.surfaces.filter((s) => s.kind === "abbreviation").map((s) => s.text),
      aliases: input.surfaces.filter((s) => s.kind === "alias").map((s) => s.text),
      discouragedNames: input.surfaces.filter((s) => s.kind === "discouraged").map((s) => s.text),
      forbiddenNames: input.surfaces.filter((s) => s.kind === "forbidden").map((s) => s.text) };
  }), []);
  for (const row of report.rows) {
    const conflict = verdict.conflicts.find((c) => c.rowNumber === row.rowNumber);
    if (conflict) row.reasons.push(`기존 용어와 겹칩니다: ${conflict.conflictingSlugs.join(", ")}. ${row.mergeIntoTerm ? "선택한 대표 용어로 합칠지 확인해 주세요." : "별개 용어로 등록할지 확인해 주세요."}`);
    for (const duplicate of verdict.duplicatesInFile.filter((d) => d.rowNumbers.includes(row.rowNumber))) {
      row.reasons.push(`입력 내 ${duplicate.rowNumbers.join(", ")}행의 표기가 겹칩니다: ${duplicate.key}`);
    }
    row.fingerprint = createHash("sha256").update(reviewFingerprint(row)).digest("hex");
  }
  return { report, mapped: effective, inputs };
}
