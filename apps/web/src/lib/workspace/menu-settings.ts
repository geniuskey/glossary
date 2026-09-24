import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { workspaceSettings, type WorkspaceMenuSettings } from "@glossary/db";
import { getDb } from "@/lib/db";
import { DEFAULT_HOME_CONTENT } from "./home-content-values";
import { DEFAULT_TERM_QUALITY } from "./term-quality-values";
import { DEFAULT_WORKSPACE_MENU_SETTINGS, isWorkspaceBrandPreset, normalizeWorkspaceMenuOrder, type ResolvedWorkspaceMenuSettings } from "./menu-settings-values";

function resolveMenuSettings(value: WorkspaceMenuSettings | null | undefined): ResolvedWorkspaceMenuSettings {
  const { order, brandPreset, ...visibility } = value ?? {};
  return {
    ...DEFAULT_WORKSPACE_MENU_SETTINGS,
    ...visibility,
    order: normalizeWorkspaceMenuOrder(order),
    // jsonb라 프리셋을 지운 뒤 남은 옛 값도 읽힌다. 모르는 값을 그대로 data-brand에
    // 걸면 CSS 블록이 하나도 맞지 않아 조용히 기본색으로 보이므로 여기서 거른다.
    brandPreset: isWorkspaceBrandPreset(brandPreset) ? brandPreset : DEFAULT_WORKSPACE_MENU_SETTINGS.brandPreset,
  };
}

// 루트 레이아웃(대표 색)과 앱 셸(메뉴)이 한 요청에서 같이 읽는다. 요청 단위로
// 묶어 두지 않으면 모든 화면이 같은 행을 두 번 조회한다.
export const getWorkspaceMenuSettings = cache(async (): Promise<ResolvedWorkspaceMenuSettings> => {
  const [row] = await getDb()
    .select({ menuSettings: workspaceSettings.menuSettings })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, "default"))
    .limit(1);

  return resolveMenuSettings(row?.menuSettings);
});

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
