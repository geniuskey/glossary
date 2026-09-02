import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { domains, terms } from "@grossary/db";
import { getDb } from "@/lib/db";
import { slugify } from "./slug";

export interface DomainOption {
  key: string;
  label: string;
}

export interface ManagedDomain extends DomainOption {
  sortOrder: number;
  usageCount: number;
}

export async function listDomains(): Promise<DomainOption[]> {
  return getDb()
    .select({ key: domains.key, label: domains.label })
    .from(domains)
    .orderBy(asc(domains.sortOrder), asc(domains.key));
}

export async function listManagedDomains(): Promise<ManagedDomain[]> {
  return getDb()
    .select({
      key: domains.key,
      label: domains.label,
      sortOrder: domains.sortOrder,
      usageCount: sql<number>`(
        select count(*)::int from ${terms}
        where ${terms.domain} @> array[${domains.label}]::text[]
      )`,
    })
    .from(domains)
    .orderBy(asc(domains.sortOrder), asc(domains.key));
}

export async function domainsExist(labels: readonly string[]): Promise<boolean> {
  const unique = [...new Set(labels)];
  if (unique.length === 0) return true;
  const rows = await getDb()
    .select({ label: domains.label })
    .from(domains)
    .where(inArray(domains.label, unique));
  return rows.length === unique.length;
}

async function uniqueDomainKey(label: string): Promise<string> {
  const base = slugify(label).slice(0, 64) || "domain";
  const rows = await getDb().select({ key: domains.key }).from(domains);
  const taken = new Set(rows.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createDomain(label: string): Promise<ManagedDomain | null> {
  const db = getDb();
  const normalized = label.trim();
  const [duplicate] = await db
    .select({ key: domains.key })
    .from(domains)
    .where(sql`lower(${domains.label}) = lower(${normalized})`)
    .limit(1);
  if (duplicate) return null;

  const [orderRow] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${domains.sortOrder}), -1)::int + 1` })
    .from(domains);
  const key = await uniqueDomainKey(normalized);
  const [created] = await db
    .insert(domains)
    .values({ key, label: normalized, sortOrder: orderRow?.nextOrder ?? 0 })
    .returning();
  return created ? { ...created, usageCount: 0 } : null;
}

export async function renameDomain(key: string, label: string): Promise<"ok" | "not_found" | "duplicate"> {
  const db = getDb();
  const normalized = label.trim();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(domains).where(eq(domains.key, key)).limit(1);
    if (!current) return "not_found" as const;
    const [duplicate] = await tx
      .select({ key: domains.key })
      .from(domains)
      .where(and(sql`${domains.key} <> ${key}`, sql`lower(${domains.label}) = lower(${normalized})`))
      .limit(1);
    if (duplicate) return "duplicate" as const;
    await tx.update(domains).set({ label: normalized, updatedAt: new Date() }).where(eq(domains.key, key));
    if (current.label !== normalized) {
      await tx
        .update(terms)
        .set({ domain: sql`array_replace(${terms.domain}, ${current.label}, ${normalized})` })
        .where(sql`${terms.domain} @> array[${current.label}]::text[]`);
    }
    return "ok" as const;
  });
}

export async function reorderDomains(keys: readonly string[]): Promise<boolean> {
  const db = getDb();
  const current = await listDomains();
  if (keys.length !== current.length || new Set(keys).size !== keys.length) return false;
  const known = new Set(current.map((domain) => domain.key));
  if (keys.some((key) => !known.has(key))) return false;
  await db.transaction(async (tx) => {
    for (const [sortOrder, key] of keys.entries()) {
      await tx.update(domains).set({ sortOrder, updatedAt: new Date() }).where(eq(domains.key, key));
    }
  });
  return true;
}

export async function deleteDomain(key: string, allowInUse = false): Promise<"ok" | "not_found" | "in_use"> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(domains).where(eq(domains.key, key)).limit(1);
    if (!current) return "not_found" as const;
    const [usage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(terms)
      .where(sql`${terms.domain} @> array[${current.label}]::text[]`);
    if ((usage?.count ?? 0) > 0 && !allowInUse) return "in_use" as const;
    if ((usage?.count ?? 0) > 0) {
      await tx
        .update(terms)
        .set({ domain: sql`array_remove(${terms.domain}, ${current.label})` })
        .where(sql`${terms.domain} @> array[${current.label}]::text[]`);
    }
    await tx.delete(domains).where(eq(domains.key, key));
    return "ok" as const;
  });
}
