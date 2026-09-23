import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { domains, terms } from "@glossary/db";
import { getDb } from "@/lib/db";
import { queueAllRagTerms, scheduleRagIndexing } from "@/lib/rag/indexer";
import { firstUnusedDomainColor } from "./domain-colors";
import { uniqueDomainKey } from "./domain-catalog";

export interface DomainOption {
  key: string;
  label: string;
  color: string;
}

export interface ManagedDomain extends DomainOption {
  sortOrder: number;
  usageCount: number;
}

export async function listDomains(): Promise<DomainOption[]> {
  return getDb()
    .select({ key: domains.key, label: domains.label, color: domains.color })
    .from(domains)
    .orderBy(asc(domains.sortOrder), asc(domains.key));
}

export async function listManagedDomains(): Promise<ManagedDomain[]> {
  return getDb()
    .select({
      key: domains.key,
      label: domains.label,
      color: domains.color,
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

/**
 * 수정 요청에서 새로 붙이는 도메인만 분류 체계와 대조한다. 편집 폼은 도메인을
 * 건드리지 않아도 배열 전체를 다시 보내므로, 전체를 검사하면 가져오기·시드로
 * 분류 체계 밖 값이 이미 붙어 있던 용어는 정의 한 줄 고치는 저장까지 전부
 * "분류 체계에 없는 도메인" 400으로 막힌다(실측: 분류 체계에 있는 도메인만 가진
 * 용어만 저장되고 나머지는 전부 실패).
 */
export function addedDomains(next: readonly string[], previous: readonly string[]): string[] {
  const kept = new Set(previous);
  return next.filter((label) => !kept.has(label));
}

export async function createDomain(label: string): Promise<ManagedDomain | "duplicate" | "palette_full"> {
  const db = getDb();
  const normalized = label.trim();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('glossary_domain_catalog'))`);
    const current = await tx.select({ key: domains.key, label: domains.label, color: domains.color }).from(domains);
    if (current.some((domain) => domain.label.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return "duplicate" as const;
    const color = firstUnusedDomainColor(new Set(current.map((domain) => domain.color)));
    if (!color) return "palette_full" as const;
    const [orderRow] = await tx
      .select({ nextOrder: sql<number>`coalesce(max(${domains.sortOrder}), -1)::int + 1` })
      .from(domains);
    const key = uniqueDomainKey(normalized, new Set(current.map((domain) => domain.key)));
    const [created] = await tx
      .insert(domains)
      .values({ key, label: normalized, color, sortOrder: orderRow?.nextOrder ?? 0 })
      .returning();
    return { ...created!, usageCount: 0 };
  });
}

export async function updateDomain(
  key: string,
  input: { label?: string; color?: string },
): Promise<"ok" | "not_found" | "duplicate_label" | "duplicate_color"> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('glossary_domain_catalog'))`);
    const [current] = await tx.select().from(domains).where(eq(domains.key, key)).limit(1);
    if (!current) return "not_found" as const;
    const normalized = input.label?.trim();
    if (normalized !== undefined) {
      const [duplicate] = await tx
        .select({ key: domains.key })
        .from(domains)
        .where(and(sql`${domains.key} <> ${key}`, sql`lower(${domains.label}) = lower(${normalized})`))
        .limit(1);
      if (duplicate) return "duplicate_label" as const;
    }
    if (input.color !== undefined) {
      const [duplicate] = await tx
        .select({ key: domains.key })
        .from(domains)
        .where(and(sql`${domains.key} <> ${key}`, eq(domains.color, input.color)))
        .limit(1);
      if (duplicate) return "duplicate_color" as const;
    }
    await tx.update(domains).set({
      ...(normalized !== undefined ? { label: normalized } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      updatedAt: new Date(),
    }).where(eq(domains.key, key));
    if (normalized !== undefined && current.label !== normalized) {
      await tx
        .update(terms)
        .set({ domain: sql`array_replace(${terms.domain}, ${current.label}, ${normalized})` })
        .where(sql`${terms.domain} @> array[${current.label}]::text[]`);
    }
    return "ok" as const;
  });
  if (result === "ok") {
    await queueAllRagTerms();
    scheduleRagIndexing(8);
  }
  return result;
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
  const result = await db.transaction(async (tx) => {
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
  if (result === "ok") {
    await queueAllRagTerms();
    scheduleRagIndexing(8);
  }
  return result;
}
