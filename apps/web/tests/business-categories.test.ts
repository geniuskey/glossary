import { afterAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { businessCategories, createDb, terms } from "@glossary/db";
import {
  createBusinessCategory,
  deleteBusinessCategory,
  listBusinessCategories,
  listManagedBusinessCategories,
  renameBusinessCategory,
  reorderBusinessCategories,
} from "../src/lib/terms/categories.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const marker = `보안 분류 ${Date.now()}`;
const markerEn = `Security Category ${Date.now()}`;
let categoryKey = "";
let termId = "";

afterAll(async () => {
  if (termId) await db.delete(terms).where(eq(terms.id, termId));
  if (categoryKey) await db.delete(businessCategories).where(eq(businessCategories.key, categoryKey));
});

test("업무 분류는 한글·영문 이름으로 추가하고 두 이름을 함께 바꿀 수 있다", async () => {
  const created = await createBusinessCategory(marker, markerEn);
  expect(created).not.toBeNull();
  categoryKey = created!.key;
  expect(categoryKey).toMatch(/^[\p{Letter}\p{Number}-]+$/u);

  expect(created?.labelEn).toBe(markerEn);
  expect(await createBusinessCategory(marker.toLowerCase(), `${markerEn} duplicate`)).toBeNull();
  expect(await createBusinessCategory(`${marker} 중복`, markerEn.toLowerCase())).toBeNull();
  expect(await renameBusinessCategory(categoryKey, `${marker} 변경`, `${markerEn} Changed`)).toBe("ok");

  const listed = await listBusinessCategories();
  expect(listed.find((category) => category.key === categoryKey)?.label).toBe(`${marker} 변경`);
  expect(listed.find((category) => category.key === categoryKey)?.labelEn).toBe(`${markerEn} Changed`);
});

test("표시 순서를 저장하되 빠지거나 중복된 key 목록은 거부한다", async () => {
  const before = await listBusinessCategories();
  const reversed = [...before].reverse().map((category) => category.key);
  expect(await reorderBusinessCategories(reversed)).toBe(true);
  expect((await listBusinessCategories()).map((category) => category.key)).toEqual(reversed);
  expect(await reorderBusinessCategories(reversed.slice(1))).toBe(false);
  expect(await reorderBusinessCategories([...reversed.slice(0, -1), reversed[0]!])).toBe(false);
  expect(await reorderBusinessCategories(before.map((category) => category.key))).toBe(true);
});

test("사용 중인 업무 분류는 일반 삭제를 막고 관리자 삭제 시 연결 용어를 미분류로 바꾼다", async () => {
  const [term] = await db.insert(terms).values({
    slug: `category-guard-${Date.now()}`,
    nameEn: "Category guard fixture",
    category: [categoryKey],
  }).returning({ id: terms.id });
  termId = term!.id;

  const managed = await listManagedBusinessCategories();
  expect(managed.find((category) => category.key === categoryKey)?.usageCount).toBe(1);
  expect(await deleteBusinessCategory(categoryKey)).toBe("in_use");
  expect(await deleteBusinessCategory(categoryKey, true)).toBe("ok");
  const [unclassified] = await db.select({ category: terms.category }).from(terms).where(eq(terms.id, termId));
  expect(unclassified?.category).toEqual([]);
  categoryKey = "";
});
