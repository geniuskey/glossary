import { normalizeSurface } from "@glossary/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, surfaceKeys, terms, termSurfaces } from "../src/index";

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error("DATABASE_URL_TEST is required");
const db = createDb(url);

let termId: string;

beforeAll(async () => {
  const [row] = await db
    .insert(terms)
    .values({ slug: `parity-${Date.now()}`, nameEn: "Auto Exposure", status: "active" })
    .returning();
  termId = row!.id;
});

afterAll(async () => {
  await db.delete(terms).where(eq(terms.id, termId));
});

test("저장된 정규화 컬럼이 engine 함수 출력과 정확히 일치한다", async () => {
  const inputs = ["Auto Exposure", "White Balance", "MIPI Rx", "이미지 센서", "IMX999"];

  await db.insert(termSurfaces).values(
    inputs.map((text) => ({ termId, text, kind: "alias" as const, ...surfaceKeys(text) })),
  );

  const rows = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, termId));

  for (const row of rows) {
    const expected = normalizeSurface(row.text);
    expect(row.normLoose).toBe(expected.loose);
    expect(row.normSpace).toBe(expected.space);
  }
});
