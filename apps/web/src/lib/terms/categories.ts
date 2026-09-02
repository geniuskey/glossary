import "server-only";

import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { businessCategories, terms } from "@grossary/db";
import { getDb } from "@/lib/db";
import { slugify } from "./slug";

export interface BusinessCategoryOption {
  key: string;
  /** 기존 화면에서 쓰는 기본 표시명. 현재는 한글 이름과 같다. */
  label: string;
  labelKo: string;
  labelEn: string;
}

export interface ManagedBusinessCategory extends BusinessCategoryOption {
  sortOrder: number;
  usageCount: number;
}

export async function listBusinessCategories(): Promise<BusinessCategoryOption[]> {
  return getDb()
    .select({
      key: businessCategories.key,
      label: businessCategories.label,
      labelKo: businessCategories.label,
      labelEn: businessCategories.labelEn,
    })
    .from(businessCategories)
    .orderBy(asc(businessCategories.sortOrder), asc(businessCategories.key));
}

export async function listManagedBusinessCategories(): Promise<ManagedBusinessCategory[]> {
  return getDb()
    .select({
      key: businessCategories.key,
      label: businessCategories.label,
      labelKo: businessCategories.label,
      labelEn: businessCategories.labelEn,
      sortOrder: businessCategories.sortOrder,
      usageCount: sql<number>`count(${terms.id})::int`,
    })
    .from(businessCategories)
    .leftJoin(terms, sql`${businessCategories.key} = any(${terms.category})`)
    .groupBy(
      businessCategories.key,
      businessCategories.label,
      businessCategories.labelEn,
      businessCategories.sortOrder,
    )
    .orderBy(asc(businessCategories.sortOrder), asc(businessCategories.key));
}

export async function businessCategoryExists(key: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(eq(businessCategories.key, key))
    .limit(1);
  return Boolean(row);
}

export async function businessCategoriesExist(keys: readonly string[]): Promise<boolean> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return true;
  const rows = await getDb()
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(inArray(businessCategories.key, unique));
  return rows.length === unique.length;
}

async function uniqueCategoryKey(labelEn: string): Promise<string> {
  const base = slugify(labelEn).slice(0, 64) || "category";
  const rows = await getDb().select({ key: businessCategories.key }).from(businessCategories);
  const taken = new Set(rows.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createBusinessCategory(
  labelKo: string,
  labelEn: string,
): Promise<ManagedBusinessCategory | null> {
  const db = getDb();
  const normalizedKo = labelKo.trim();
  const normalizedEn = labelEn.trim();
  const [duplicate] = await db
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(or(
      sql`lower(${businessCategories.label}) = lower(${normalizedKo})`,
      sql`lower(${businessCategories.labelEn}) = lower(${normalizedEn})`,
    ))
    .limit(1);
  if (duplicate) return null;

  const [orderRow] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${businessCategories.sortOrder}), -1)::int + 1` })
    .from(businessCategories);
  const key = await uniqueCategoryKey(normalizedEn);
  const [created] = await db
    .insert(businessCategories)
    .values({ key, label: normalizedKo, labelEn: normalizedEn, sortOrder: orderRow?.nextOrder ?? 0 })
    .returning();
  return created ? {
    key: created.key,
    label: created.label,
    labelKo: created.label,
    labelEn: created.labelEn,
    sortOrder: created.sortOrder,
    usageCount: 0,
  } : null;
}

export async function renameBusinessCategory(
  key: string,
  labelKo: string,
  labelEn: string,
): Promise<"ok" | "not_found" | "duplicate"> {
  const db = getDb();
  const normalizedKo = labelKo.trim();
  const normalizedEn = labelEn.trim();
  const [duplicate] = await db
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(and(
      sql`${businessCategories.key} <> ${key}`,
      or(
        sql`lower(${businessCategories.label}) = lower(${normalizedKo})`,
        sql`lower(${businessCategories.labelEn}) = lower(${normalizedEn})`,
      ),
    ))
    .limit(1);
  if (duplicate) return "duplicate";
  const [updated] = await db
    .update(businessCategories)
    .set({ label: normalizedKo, labelEn: normalizedEn, updatedAt: new Date() })
    .where(eq(businessCategories.key, key))
    .returning({ key: businessCategories.key });
  return updated ? "ok" : "not_found";
}

export async function reorderBusinessCategories(keys: readonly string[]): Promise<boolean> {
  const db = getDb();
  const current = await listBusinessCategories();
  if (keys.length !== current.length || new Set(keys).size !== keys.length) return false;
  const known = new Set(current.map((category) => category.key));
  if (keys.some((key) => !known.has(key))) return false;
  await db.transaction(async (tx) => {
    for (const [sortOrder, key] of keys.entries()) {
      await tx.update(businessCategories).set({ sortOrder, updatedAt: new Date() }).where(eq(businessCategories.key, key));
    }
  });
  return true;
}

export async function deleteBusinessCategory(
  key: string,
  allowInUse = false,
): Promise<"ok" | "not_found" | "in_use"> {
  const db = getDb();
  if (allowInUse) {
    await db.update(terms).set({
      category: sql`array_remove(${terms.category}, ${key})`,
      updatedAt: new Date(),
    }).where(sql`${key} = any(${terms.category})`);
  }
  const [deleted] = await db
    .delete(businessCategories)
    .where(and(
      eq(businessCategories.key, key),
      allowInUse ? undefined : notExists(
        db.select({ id: terms.id }).from(terms).where(sql`${key} = any(${terms.category})`),
      ),
    ))
    .returning({ key: businessCategories.key });
  if (deleted) return "ok";
  const [existing] = await db
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(eq(businessCategories.key, key))
    .limit(1);
  return existing ? "in_use" : "not_found";
}
