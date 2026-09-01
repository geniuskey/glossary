import "server-only";

import { asc, count, eq, sql } from "drizzle-orm";
import { businessCategories, terms } from "@grossary/db";
import { getDb } from "@/lib/db";
import { slugify } from "./slug";

export interface BusinessCategoryOption {
  key: string;
  label: string;
}

export interface ManagedBusinessCategory extends BusinessCategoryOption {
  sortOrder: number;
  usageCount: number;
}

export async function listBusinessCategories(): Promise<BusinessCategoryOption[]> {
  return getDb()
    .select({ key: businessCategories.key, label: businessCategories.label })
    .from(businessCategories)
    .orderBy(asc(businessCategories.sortOrder), asc(businessCategories.key));
}

export async function listManagedBusinessCategories(): Promise<ManagedBusinessCategory[]> {
  return getDb()
    .select({
      key: businessCategories.key,
      label: businessCategories.label,
      sortOrder: businessCategories.sortOrder,
      usageCount: sql<number>`count(${terms.id})::int`,
    })
    .from(businessCategories)
    .leftJoin(terms, eq(terms.category, businessCategories.key))
    .groupBy(businessCategories.key, businessCategories.label, businessCategories.sortOrder)
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

async function uniqueCategoryKey(label: string): Promise<string> {
  const base = slugify(label).slice(0, 64) || "category";
  const rows = await getDb().select({ key: businessCategories.key }).from(businessCategories);
  const taken = new Set(rows.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createBusinessCategory(label: string): Promise<ManagedBusinessCategory | null> {
  const db = getDb();
  const normalized = label.trim();
  const [duplicate] = await db
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(sql`lower(${businessCategories.label}) = lower(${normalized})`)
    .limit(1);
  if (duplicate) return null;

  const [orderRow] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${businessCategories.sortOrder}), -1)::int + 1` })
    .from(businessCategories);
  const key = await uniqueCategoryKey(normalized);
  const [created] = await db
    .insert(businessCategories)
    .values({ key, label: normalized, sortOrder: orderRow?.nextOrder ?? 0 })
    .returning();
  return created ? { key: created.key, label: created.label, sortOrder: created.sortOrder, usageCount: 0 } : null;
}

export async function renameBusinessCategory(key: string, label: string): Promise<"ok" | "not_found" | "duplicate"> {
  const db = getDb();
  const normalized = label.trim();
  const [duplicate] = await db
    .select({ key: businessCategories.key })
    .from(businessCategories)
    .where(sql`lower(${businessCategories.label}) = lower(${normalized}) and ${businessCategories.key} <> ${key}`)
    .limit(1);
  if (duplicate) return "duplicate";
  const [updated] = await db
    .update(businessCategories)
    .set({ label: normalized, updatedAt: new Date() })
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

export async function deleteBusinessCategory(key: string): Promise<"ok" | "not_found" | "in_use"> {
  const db = getDb();
  const [usageRow] = await db
    .select({ usageCount: count(terms.id) })
    .from(terms)
    .where(eq(terms.category, key));
  if (Number(usageRow?.usageCount ?? 0) > 0) return "in_use";
  const [deleted] = await db
    .delete(businessCategories)
    .where(eq(businessCategories.key, key))
    .returning({ key: businessCategories.key });
  return deleted ? "ok" : "not_found";
}
