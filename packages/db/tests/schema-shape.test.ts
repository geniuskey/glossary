import { expect, test } from "vitest";
import {
  aiReviewQueue, apiKeys, attachmentRefs, attachments, createDb, sessions, ssoConfig, termRelations, termRevisions, terms, users, workspaceSettings,
} from "../src/index";

const db = createDb(process.env.DATABASE_URL_TEST!);

test("모든 신규 테이블에 조회가 가능하다", async () => {
  for (const table of [users, sessions, apiKeys, ssoConfig, termRevisions, terms, termRelations, aiReviewQueue, workspaceSettings, attachments, attachmentRefs]) {
    const rows = await db.select().from(table).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  }
});
