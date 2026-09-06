import "server-only";

import { eq, inArray } from "drizzle-orm";
import { terms, workspaceSettings } from "@glossary/db";
import { getDb } from "@/lib/db";
import { completionStatus, termCompletion } from "@/lib/terms/completion";
import { DEFAULT_HOME_CONTENT } from "./home-content-values";
import { DEFAULT_TERM_QUALITY, type TermQualitySettings } from "./term-quality-values";

export async function getTermQualitySettings(): Promise<TermQualitySettings> {
  const [row] = await getDb()
    .select({
      definitionMinChars: workspaceSettings.definitionMinChars,
      bodyMinChars: workspaceSettings.bodyMinChars,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, "default"))
    .limit(1);

  return row ?? DEFAULT_TERM_QUALITY;
}

export async function saveTermQualitySettings(settings: TermQualitySettings, updatedBy: string): Promise<TermQualitySettings> {
  const updatedAt = new Date();
  const [saved] = await getDb()
    .insert(workspaceSettings)
    .values({
      id: "default",
      homeEyebrow: DEFAULT_HOME_CONTENT.eyebrow,
      homeTitle: DEFAULT_HOME_CONTENT.title,
      homeDescription: DEFAULT_HOME_CONTENT.description,
      ...settings,
      updatedBy,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: { ...settings, updatedBy, updatedAt },
    })
    .returning({
      definitionMinChars: workspaceSettings.definitionMinChars,
      bodyMinChars: workspaceSettings.bodyMinChars,
    });

  // 상태는 사용자 선택값이 아니라 기준 판정의 캐시다. 기준 자체가 바뀌면 기존
  // 용어도 즉시 같은 규칙으로 다시 판정해야 목록·검색 노출이 서로 어긋나지 않는다.
  const rows = await getDb().select().from(terms);
  const idsByStatus = { draft: [] as string[], active: [] as string[] };
  for (const row of rows) {
    const status = completionStatus({ ...row, categories: row.category }, saved!);
    if (row.status !== status) idsByStatus[status].push(row.id);
  }
  await Promise.all((['draft', 'active'] as const).map(async (status) => {
    const ids = idsByStatus[status];
    if (ids.length > 0) await getDb().update(terms).set({ status }).where(inArray(terms.id, ids));
  }));

  return saved!;
}

export interface TermQualityOverview {
  total: number;
  complete: number;
  incomplete: number;
  profiles: Record<"mapping" | "context" | "guidance", { total: number; complete: number }>;
}

export async function getTermQualityOverview(settings: TermQualitySettings): Promise<TermQualityOverview> {
  const rows = await getDb().select({
    qualityProfile: terms.qualityProfile,
    nameEn: terms.nameEn,
    nameKo: terms.nameKo,
    fullNameEn: terms.fullNameEn,
    fullNameKo: terms.fullNameKo,
    definitionMd: terms.definitionMd,
    bodyMd: terms.bodyMd,
    domain: terms.domain,
    categories: terms.category,
    status: terms.status,
  }).from(terms);

  const profiles: TermQualityOverview["profiles"] = {
    mapping: { total: 0, complete: 0 },
    context: { total: 0, complete: 0 },
    guidance: { total: 0, complete: 0 },
  };
  let complete = 0;
  for (const row of rows) {
    const result = termCompletion(row, settings);
    profiles[result.resolvedProfile].total += 1;
    if (result.complete) {
      profiles[result.resolvedProfile].complete += 1;
      complete += 1;
    }
  }
  return { total: rows.length, complete, incomplete: rows.length - complete, profiles };
}
