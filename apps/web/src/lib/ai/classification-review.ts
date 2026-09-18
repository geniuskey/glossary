import "server-only";

import { and, eq } from "drizzle-orm";
import { classificationReviewSuggestions } from "@glossary/db";
import { currentRevisionNumber } from "@/lib/terms/update";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { getDb } from "@/lib/db";
import type { ClassificationReviewKind } from "@/lib/terms/classification-review";
import { generateContributionSuggestions } from "./contribution-agent";
import type { ContributionSuggestion } from "./contribution-suggestions";
import { AI_SUGGESTION_GENERATOR_VERSIONS, classificationSuggestionId } from "./suggestion-disposition-values";
import { getSuggestionDisposition, isHiddenSuggestionDisposition } from "./suggestion-dispositions";

export interface ClassificationSuggestion {
  termId: string;
  revision: number;
  values: string[];
  reason: string;
}

const inFlight = new Map<string, Promise<ClassificationSuggestion | null>>();
const INSUFFICIENT_EVIDENCE = "AI가 추천할 충분한 근거를 찾지 못했습니다.";

function isClassificationSuggestion(
  suggestion: ContributionSuggestion,
  kind: ClassificationReviewKind,
): suggestion is ContributionSuggestion & { field: ClassificationReviewKind; value: string[] } {
  return suggestion.field === kind && Array.isArray(suggestion.value);
}

async function generate(
  termId: string,
  kind: ClassificationReviewKind,
  expectedRevision: number,
  force: boolean,
  userId: string | null,
): Promise<ClassificationSuggestion | null> {
  const term = await getTermByIdOrSlug(termId);
  if (!term) throw new Error("TERM_NOT_FOUND");
  const revision = await currentRevisionNumber(termId);
  if (revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
  if ((kind === "domain" ? term.domain : term.categories).length > 0) throw new Error("NOT_ELIGIBLE");

  if (!force) {
    const decision = await getSuggestionDisposition(termId, revision, "classification", classificationSuggestionId(kind), userId, AI_SUGGESTION_GENERATOR_VERSIONS.classification);
    if (decision && isHiddenSuggestionDisposition(decision.disposition)) return null;
  }

  const db = getDb();
  if (!force) {
    const [cached] = await db
      .select({ revision: classificationReviewSuggestions.revision, values: classificationReviewSuggestions.values, reason: classificationReviewSuggestions.reason })
      .from(classificationReviewSuggestions)
      .where(and(
        eq(classificationReviewSuggestions.termId, termId),
        eq(classificationReviewSuggestions.kind, kind),
        eq(classificationReviewSuggestions.revision, revision),
      ))
      .limit(1);
    if (cached) {
      if (cached.values.length === 0) return null;
      return { termId, revision: cached.revision, values: cached.values, reason: cached.reason };
    }
  }

  const generated = await generateContributionSuggestions(term);
  const suggestion = generated.find((item) => isClassificationSuggestion(item, kind));
  if (await currentRevisionNumber(termId) !== revision) throw new Error("REVISION_CONFLICT");
  const values = suggestion && Array.isArray(suggestion.value) ? suggestion.value : [];
  const reason = suggestion?.reason ?? INSUFFICIENT_EVIDENCE;

  await db.insert(classificationReviewSuggestions).values({
    termId,
    kind,
    revision,
    values,
    reason,
  }).onConflictDoUpdate({
    target: [classificationReviewSuggestions.termId, classificationReviewSuggestions.kind],
    set: { revision, values, reason, generatedAt: new Date() },
  });

  if (values.length === 0) return null;

  return {
    termId,
    revision,
    values,
    reason,
  };
}

/** 같은 용어의 중복 클릭은 하나의 AI 요청으로 합친다. 결과는 화면에서 승인할 때까지 유지한다. */
export function generateClassificationSuggestion(
  termId: string,
  kind: ClassificationReviewKind,
  expectedRevision: number,
  force = false,
  userId: string | null = null,
): Promise<ClassificationSuggestion | null> {
  const key = `${termId}:${kind}:${expectedRevision}:${force ? "force" : "cached"}:${userId ?? "shared"}`;
  const running = inFlight.get(key);
  if (running) return running;
  const task = generate(termId, kind, expectedRevision, force, userId).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}
