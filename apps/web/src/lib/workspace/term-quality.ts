import "server-only";

import { eq } from "drizzle-orm";
import { workspaceSettings } from "@grossary/db";
import { getDb } from "@/lib/db";
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

  return saved!;
}
