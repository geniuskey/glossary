import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, or, sql, type InferSelectModel } from "drizzle-orm";
import { meetingDocuments, meetingDocumentStatusEnum } from "@glossary/db";
import { getDb } from "@/lib/db";
import { queueMeetingIndex, scheduleMeetingRagIndexing } from "@/lib/rag/meeting-indexer";

const MAX_TITLE_LENGTH = 240;
const MAX_METADATA_LENGTH = 200;
export const MAX_MEETING_CONTENT_LENGTH = 200_000;

export type MeetingDocument = InferSelectModel<typeof meetingDocuments>;
export type MeetingDocumentStatus = (typeof meetingDocumentStatusEnum.enumValues)[number];

export interface MeetingDocumentInput {
  title: string;
  meetingDate: Date | null;
  source: string;
  team: string;
  domain: string[];
  content: string;
}

export interface MeetingDocumentPatch {
  title?: string;
  meetingDate?: Date | null;
  source?: string;
  team?: string;
  domain?: string[];
  content?: string;
  status?: MeetingDocumentStatus;
}

export interface ListMeetingDocumentsOptions {
  query?: string;
  status?: MeetingDocumentStatus;
  domain?: string;
  team?: string;
  page: number;
  pageSize: number;
}

function normalized(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function hashContent(input: Pick<MeetingDocumentInput, "title" | "source" | "team" | "domain" | "content">): string {
  return createHash("sha256").update(JSON.stringify({
    title: input.title,
    source: input.source,
    team: input.team,
    domain: input.domain,
    content: input.content,
  }), "utf8").digest("hex");
}

function validateInput(input: MeetingDocumentInput): void {
  if (!input.title.trim() || input.title.length > MAX_TITLE_LENGTH) throw new Error("회의록 제목을 확인해 주세요.");
  if (input.source.length > MAX_METADATA_LENGTH || input.team.length > MAX_METADATA_LENGTH) throw new Error("회의록 출처와 팀은 200자 이하여야 합니다.");
  if (input.domain.length > 20 || input.domain.some((value) => value.length > MAX_METADATA_LENGTH)) throw new Error("회의록 도메인을 확인해 주세요.");
  if (!input.content.trim() || input.content.length > MAX_MEETING_CONTENT_LENGTH) throw new Error("회의록 원문은 1자 이상 200,000자 이하여야 합니다.");
}

function validatePatch(patch: MeetingDocumentPatch): void {
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > MAX_TITLE_LENGTH)) throw new Error("회의록 제목을 확인해 주세요.");
  if (patch.source !== undefined && patch.source.length > MAX_METADATA_LENGTH) throw new Error("회의록 출처는 200자 이하여야 합니다.");
  if (patch.team !== undefined && patch.team.length > MAX_METADATA_LENGTH) throw new Error("회의록 팀은 200자 이하여야 합니다.");
  if (patch.domain !== undefined && (patch.domain.length > 20 || patch.domain.some((value) => value.length > MAX_METADATA_LENGTH))) throw new Error("회의록 도메인을 확인해 주세요.");
  if (patch.content !== undefined && (!patch.content.trim() || patch.content.length > MAX_MEETING_CONTENT_LENGTH)) throw new Error("회의록 원문은 1자 이상 200,000자 이하여야 합니다.");
}

export function toMeetingDocumentWire(row: MeetingDocument, includeContent = false) {
  return {
    id: row.id,
    title: row.title,
    meetingDate: row.meetingDate?.toISOString() ?? null,
    source: row.source,
    team: row.team,
    domain: row.domain,
    ...(includeContent ? { content: row.content } : {}),
    revision: row.revision,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 원문 저장과 최신 revision 색인 요청을 같은 트랜잭션에서 처리한다. */
export async function createMeetingDocument(input: MeetingDocumentInput, createdBy: string | null): Promise<MeetingDocument> {
  const normalizedInput = {
    ...input,
    title: normalized(input.title),
    source: normalized(input.source),
    team: normalized(input.team),
    domain: [...new Set(input.domain.map((value) => normalized(value)).filter(Boolean))],
    content: input.content.replace(/\r\n?/g, "\n").trim(),
  };
  validateInput(normalizedInput);
  const [created] = await getDb().transaction(async (tx) => {
    const [row] = await tx.insert(meetingDocuments).values({
      ...normalizedInput,
      contentHash: hashContent(normalizedInput),
      createdBy,
      revision: 1,
      status: "active",
    }).returning();
    if (!row) throw new Error("회의록을 저장하지 못했습니다.");
    await queueMeetingIndex(tx, row.id, row.revision);
    return [row] as const;
  });
  scheduleMeetingRagIndexing(2);
  return created;
}

export async function getMeetingDocument(id: string): Promise<MeetingDocument | null> {
  const [row] = await getDb().select().from(meetingDocuments).where(eq(meetingDocuments.id, id)).limit(1);
  return row ?? null;
}

export async function listMeetingDocuments(options: ListMeetingDocumentsOptions): Promise<{ items: MeetingDocument[]; total: number }> {
  const filters = [
    options.status ? eq(meetingDocuments.status, options.status) : eq(meetingDocuments.status, "active"),
    options.domain ? sql`${options.domain} = any(${meetingDocuments.domain})` : undefined,
    options.team ? ilike(meetingDocuments.team, `%${options.team}%`) : undefined,
    options.query ? or(
      ilike(meetingDocuments.title, `%${options.query}%`),
      ilike(meetingDocuments.source, `%${options.query}%`),
      ilike(meetingDocuments.team, `%${options.query}%`),
      ilike(meetingDocuments.content, `%${options.query}%`),
    ) : undefined,
  ];
  const where = and(...filters);
  const db = getDb();
  const [totalRow, items] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(meetingDocuments).where(where),
    db.select().from(meetingDocuments).where(where)
      .orderBy(desc(meetingDocuments.meetingDate), desc(meetingDocuments.updatedAt), asc(meetingDocuments.id))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
  ]);
  return { items, total: totalRow[0]?.count ?? 0 };
}

/** 내용·메타데이터 변경은 새 revision으로 색인하고, 보관 전환은 기존 청크를 제거한다. */
export async function updateMeetingDocument(id: string, patch: MeetingDocumentPatch): Promise<MeetingDocument | null> {
  validatePatch(patch);
  const result = await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(meetingDocuments).where(eq(meetingDocuments.id, id)).limit(1);
    if (!current) return null;
    const contentChanged = patch.content !== undefined || patch.title !== undefined || patch.source !== undefined
      || patch.team !== undefined || patch.domain !== undefined;
    const next: MeetingDocumentInput = {
      title: normalized(patch.title ?? current.title),
      meetingDate: patch.meetingDate === undefined ? current.meetingDate : patch.meetingDate,
      source: normalized(patch.source ?? current.source),
      team: normalized(patch.team ?? current.team),
      domain: [...new Set((patch.domain ?? current.domain).map((value) => normalized(value)).filter(Boolean))],
      content: (patch.content ?? current.content).replace(/\r\n?/g, "\n").trim(),
    };
    validateInput(next);
    const revision = contentChanged ? current.revision + 1 : current.revision;
    const [updated] = await tx.update(meetingDocuments).set({
      ...next,
      contentHash: hashContent(next),
      revision,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    }).where(eq(meetingDocuments.id, id)).returning();
    if (!updated) return null;
    await queueMeetingIndex(tx, updated.id, updated.revision);
    return updated;
  });
  if (result) scheduleMeetingRagIndexing(2);
  return result;
}
