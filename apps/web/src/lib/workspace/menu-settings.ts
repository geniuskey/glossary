import "server-only";

import { eq } from "drizzle-orm";
import { workspaceSettings, type WorkspaceMenuSettings } from "@glossary/db";
import { getDb } from "@/lib/db";
import { DEFAULT_HOME_CONTENT } from "./home-content-values";
import { DEFAULT_TERM_QUALITY } from "./term-quality-values";
import { DEFAULT_WORKSPACE_MENU_SETTINGS, normalizeWorkspaceMenuOrder, type ResolvedWorkspaceMenuSettings } from "./menu-settings-values";

function resolveMenuSettings(value: WorkspaceMenuSettings | null | undefined): ResolvedWorkspaceMenuSettings {
  const { order, ...visibility } = value ?? {};
  return {
    ...DEFAULT_WORKSPACE_MENU_SETTINGS,
    ...visibility,
    order: normalizeWorkspaceMenuOrder(order),
  };
}

export async function getWorkspaceMenuSettings(): Promise<ResolvedWorkspaceMenuSettings> {
  const [row] = await getDb()
    .select({ menuSettings: workspaceSettings.menuSettings })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, "default"))
    .limit(1);

  return resolveMenuSettings(row?.menuSettings);
}

export async function saveWorkspaceMenuSettings(settings: WorkspaceMenuSettings, updatedBy: string): Promise<ResolvedWorkspaceMenuSettings> {
  const resolved = resolveMenuSettings(settings);
  const updatedAt = new Date();
  const [saved] = await getDb()
    .insert(workspaceSettings)
    .values({
      id: "default",
      homeEyebrow: DEFAULT_HOME_CONTENT.eyebrow,
      homeTitle: DEFAULT_HOME_CONTENT.title,
      homeDescription: DEFAULT_HOME_CONTENT.description,
      definitionMinChars: DEFAULT_TERM_QUALITY.definitionMinChars,
      bodyMinChars: DEFAULT_TERM_QUALITY.bodyMinChars,
      menuSettings: resolved,
      updatedBy,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: { menuSettings: resolved, updatedBy, updatedAt },
    })
    .returning({ menuSettings: workspaceSettings.menuSettings });

  return resolveMenuSettings(saved?.menuSettings);
}
