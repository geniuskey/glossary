import { and, eq, lt, notExists, sql } from "drizzle-orm";
import {
  aiRuns,
  attachments,
  attachmentRefs,
  auditEvents,
  meetingDocuments,
  rateLimitBuckets,
  sessions,
  termRevisions,
  wikiPageRevisions,
  wikiPages,
} from "@glossary/db";
import { getDb } from "@/lib/db";

function days(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
}

export interface RetentionResult {
  aiRuns: number;
  auditEvents: number;
  attachments: number;
  rateLimitBuckets: number;
  sessions: number;
}

/**
 * Deletes only data with an explicit retention boundary. Attachment history is
 * preserved when a term revision still contains its content hash.
 *
 * 위키 편집기와 회의록은 /api/v1/attachments로 이미지를 올리지만 attachment_refs를
 * 남기지 않는다. 본문·리비전에 sha256이 남아 있는지 직접 보지 않으면 보존 기간이
 * 지난 뒤 살아 있는 문서의 이미지가 조용히 지워진다.
 */
export async function runDataRetention(): Promise<RetentionResult> {
  const db = getDb();
  const now = Date.now();
  const aiCutoff = new Date(now - days("GLOSSARY_AI_RUN_RETENTION_DAYS", 180, 3_650) * 86_400_000);
  const auditCutoff = new Date(now - days("GLOSSARY_AUDIT_RETENTION_DAYS", 365, 3_650) * 86_400_000);
  const attachmentCutoff = new Date(now - days("GLOSSARY_ATTACHMENT_RETENTION_DAYS", 30, 3_650) * 86_400_000);
  const rateLimitCutoff = new Date(now - 2 * 3_600_000);

  const [oldAiRuns, oldAuditEvents, oldAttachments, oldRateLimitBuckets, oldSessions] = await Promise.all([
    db.delete(aiRuns).where(and(
      lt(aiRuns.startedAt, aiCutoff),
      sql`${aiRuns.status} <> 'running'`,
    )).returning({ id: aiRuns.id }),
    db.delete(auditEvents).where(lt(auditEvents.createdAt, auditCutoff)).returning({ id: auditEvents.id }),
    db.delete(attachments).where(and(
      lt(attachments.createdAt, attachmentCutoff),
      notExists(db.select({ one: sql`1` }).from(attachmentRefs).where(eq(attachmentRefs.attachmentId, attachments.id))),
      sql`not exists (
        select 1 from ${termRevisions}
        where ${termRevisions.snapshot}::text like '%' || ${attachments.sha256} || '%'
      )`,
      sql`not exists (
        select 1 from ${wikiPages}
        where position(${attachments.sha256} in ${wikiPages.content}) > 0
      )`,
      sql`not exists (
        select 1 from ${wikiPageRevisions}
        where position(${attachments.sha256} in ${wikiPageRevisions.snapshot}::text) > 0
      )`,
      sql`not exists (
        select 1 from ${meetingDocuments}
        where position(${attachments.sha256} in ${meetingDocuments.content}) > 0
      )`,
    )).returning({ id: attachments.id }),
    db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.updatedAt, rateLimitCutoff)).returning({ key: rateLimitBuckets.key }),
    db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id }),
  ]);

  return {
    aiRuns: oldAiRuns.length,
    auditEvents: oldAuditEvents.length,
    attachments: oldAttachments.length,
    rateLimitBuckets: oldRateLimitBuckets.length,
    sessions: oldSessions.length,
  };
}
