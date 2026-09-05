import "server-only";

import { eq } from "drizzle-orm";
import { workspaceSettings } from "@glossary/db";
import { getDb } from "@/lib/db";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "./home-content-values";

export async function getHomeContent(): Promise<HomeContent> {
  const [row] = await getDb()
    .select({
      eyebrow: workspaceSettings.homeEyebrow,
      title: workspaceSettings.homeTitle,
      description: workspaceSettings.homeDescription,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, "default"))
    .limit(1);

  return row ?? DEFAULT_HOME_CONTENT;
}

export async function saveHomeContent(content: HomeContent, updatedBy: string): Promise<HomeContent> {
  const updatedAt = new Date();
  const [saved] = await getDb()
    .insert(workspaceSettings)
    .values({
      id: "default",
      homeEyebrow: content.eyebrow,
      homeTitle: content.title,
      homeDescription: content.description,
      updatedBy,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: {
        homeEyebrow: content.eyebrow,
        homeTitle: content.title,
        homeDescription: content.description,
        updatedBy,
        updatedAt,
      },
    })
    .returning({
      eyebrow: workspaceSettings.homeEyebrow,
      title: workspaceSettings.homeTitle,
      description: workspaceSettings.homeDescription,
    });

  return saved!;
}
