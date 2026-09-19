import "server-only";

import { auditEvents } from "@glossary/db";
import { getDb } from "@/lib/db";

export interface AuditActor {
  userId?: string | null;
  keyId?: string | null;
}

export async function recordAuditEvent(input: {
  action: string;
  targetType: string;
  targetId?: string | null;
  actor?: AuditActor;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb().insert(auditEvents).values({
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorUserId: input.actor?.userId ?? null,
      actorKeyId: input.actor?.keyId ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    // An audit failure must not turn a successful business mutation into a
    // retryable 500, but it must remain visible to operators.
    console.error("[audit] failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  }
}
