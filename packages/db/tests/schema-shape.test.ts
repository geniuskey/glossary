import { expect, test } from "vitest";
import { createDb, apiKeys, sessions, termRevisions, terms, users, workspaceSettings } from "../src/index";

const db = createDb(process.env.DATABASE_URL_TEST!);

test("모든 신규 테이블에 조회가 가능하다", async () => {
  for (const table of [users, sessions, apiKeys, termRevisions, terms, workspaceSettings]) {
    const rows = await db.select().from(table).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  }
});
