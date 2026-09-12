import { z } from "zod/v3";
import { createHash } from "node:crypto";
import type { ImportRow, ParseResult } from "./parse-xlsx";
import { dryRunImport } from "./apply";
import { MAX_IMPORT_ROWS } from "./format";
import { termInputSchema } from "@/lib/terms/schema";
import { splitSurfaceCell, reviewFingerprint, type ReviewReport, type ReviewDecision, type SplitOptions } from "./review";

// Invalid term lengths belong to row errors, so the user can fix or skip that row.
const names = z.array(z.string().trim().min(1).max(100_000)).max(1000);
export const reviewRequestSchema = z.object({
  columns: z.array(z.enum(["domain", "definitionMd", "bodyMd"])).max(3).default([]),
  options: z.object({ comma: z.boolean(), semicolon: z.boolean(), newline: z.boolean() }),
  decisions: z.array(z.object({
    rowNumber: z.number().int().positive(), en: names, ko: names, skip: z.boolean(),
    approval: z.string().max(100_000).optional(),
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
  const report: ReviewReport = { rows: [], errors: parsed.errors, fileErrors: parsed.fileErrors, ignoredHeaders: parsed.ignoredHeaders };
  for (const source of parsed.rows) {
    const en = splitSurfaceCell(source.nameEn ?? "", options);
    const ko = splitSurfaceCell(source.nameKo ?? "", options);
    const decision = byNumber.get(source.rowNumber);
    const row = {
      rowNumber: source.rowNumber, originalEn: source.nameEn ?? "", originalKo: source.nameKo ?? "",
      en: decision?.en ?? en.values, ko: decision?.ko ?? ko.values,
      skip: decision?.skip ?? false, approval: decision?.approval,
      domain: source.domain, definitionMd: source.definitionMd, bodyMd: source.bodyMd,
      reasons: [...new Set([...en.reasons, ...ko.reasons])], errors: [] as string[], fingerprint: "",
    };
    const converted: ImportRow = {
      ...source, nameEn: row.en[0], nameKo: row.ko[0],
      aliases: [...new Set([...source.aliases, ...row.en.slice(1), ...row.ko.slice(1)])],
    };
    const validation = termInputSchema.safeParse(reviewedInput(converted));
    if (!validation.success) row.errors = validation.error.issues.map((issue) => issue.message);
    if (!row.skip && validation.success) mapped.push(converted);
    report.rows.push(row);
  }
  const verdict = await dryRunImport(mapped, []);
  for (const row of report.rows) {
    const conflict = verdict.conflicts.find((c) => c.rowNumber === row.rowNumber);
    if (conflict) row.reasons.push(`기존 용어와 겹칩니다: ${conflict.conflictingSlugs.join(", ")}. 별개 용어로 등록할지 확인해 주세요.`);
    for (const duplicate of verdict.duplicatesInFile.filter((d) => d.rowNumbers.includes(row.rowNumber))) {
      row.reasons.push(`입력 내 ${duplicate.rowNumbers.join(", ")}행의 표기가 겹칩니다: ${duplicate.key}`);
    }
    row.fingerprint = createHash("sha256").update(reviewFingerprint(row)).digest("hex");
  }
  return { report, mapped };
}
