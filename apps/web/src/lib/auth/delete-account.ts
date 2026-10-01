import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { apiKeys, ssoWithdrawals, terms, users } from "@glossary/db";
import { interactiveAccountCondition, ssoSubjectHash } from "@/lib/auth/account-policy";
import { normalizeEmail } from "@/lib/auth/register";
import { getDb } from "@/lib/db";

export type DeleteOwnAccountResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "email_changed" | "last_admin" };

/**
 * Delete a signed-in account atomically. The shared lock also serializes this
 * operation with admin role changes, so two concurrent actions cannot remove
 * or demote every administrator.
 */
export async function deleteOwnAccount(userId: string, confirmedEmail: string): Promise<DeleteOwnAccountResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glossary_admin_roles'))`);

    const [target] = await tx
      .select({ id: users.id, email: users.email, role: users.role, externalId: users.externalId, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, reason: "not_found" };
    if (normalizeEmail(target.email) !== confirmedEmail) {
      return { ok: false, reason: "email_changed" };
    }

    if (target.role === "admin") {
      const [count] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, "admin"), ne(users.id, userId), interactiveAccountCondition()));
      if ((target.passwordHash || target.externalId) && (count?.value ?? 0) === 0) return { ok: false, reason: "last_admin" };
    }

    // Remove credentials before deleting the user. The FK is SET NULL to retain
    // audit history, so merely deleting the user would otherwise leave live keys.
    if (target.externalId) {
      await tx.insert(ssoWithdrawals).values({ subjectHash: ssoSubjectHash(target.externalId) }).onConflictDoNothing();
    }
    await tx.update(terms).set({ createdBy: null }).where(eq(terms.createdBy, userId));
    await tx.update(terms).set({ updatedBy: null }).where(eq(terms.updatedBy, userId));
    await tx.delete(apiKeys).where(eq(apiKeys.createdBy, userId));
    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true };
  });
}
