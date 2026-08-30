import "server-only";

import { eq } from "drizzle-orm";
import { workspaceSettings } from "@grossary/db";
import { getDb } from "@/lib/db";
import { DEFAULT_HOME_CONTENT } from "./home-content-values";
import { DEFAULT_IDENTITY_DISPLAY, type IdentityDisplaySettings } from "./identity-display-values";

export async function getIdentityDisplaySettings(): Promise<IdentityDisplaySettings> {
  const [row] = await getDb()
    .select({
      emailDomain: workspaceSettings.memberEmailDomain,
      organization: workspaceSettings.memberOrganization,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, "default"))
    .limit(1);

  return {
    emailDomain: row?.emailDomain ?? DEFAULT_IDENTITY_DISPLAY.emailDomain,
    organization: row?.organization ?? DEFAULT_IDENTITY_DISPLAY.organization,
  };
}

export async function saveIdentityDisplaySettings(
  settings: IdentityDisplaySettings,
  updatedBy: string,
): Promise<IdentityDisplaySettings> {
  const normalized = {
    emailDomain: settings.emailDomain.trim().toLowerCase(),
    organization: settings.organization.trim(),
  };
  const [saved] = await getDb()
    .insert(workspaceSettings)
    .values({
      id: "default",
      homeEyebrow: DEFAULT_HOME_CONTENT.eyebrow,
      homeTitle: DEFAULT_HOME_CONTENT.title,
      homeDescription: DEFAULT_HOME_CONTENT.description,
      memberEmailDomain: normalized.emailDomain || null,
      memberOrganization: normalized.organization || null,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: {
        memberEmailDomain: normalized.emailDomain || null,
        memberOrganization: normalized.organization || null,
        updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning({
      emailDomain: workspaceSettings.memberEmailDomain,
      organization: workspaceSettings.memberOrganization,
    });

  if (!saved) throw new Error("담당자 표시 설정을 저장하지 못했습니다.");
  return { emailDomain: saved.emailDomain ?? "", organization: saved.organization ?? "" };
}
