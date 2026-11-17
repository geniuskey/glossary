import { and, asc, eq, inArray } from "drizzle-orm";
import { termComments, users } from "@glossary/db";
import { getDb } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { mentionedUserIds } from "./mentions";
import type { TermCommentWire } from "./tree";

type CommentRow = typeof termComments.$inferSelect & { authorName: string | null };

export type CommentWriteResult =
  | { ok: true; comment: TermCommentWire }
  | { ok: false; code: "not_found" | "forbidden" | "validation_failed"; message: string };

function toWire(row: CommentRow): TermCommentWire {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    parentId: row.parentId,
    authorId: deleted ? null : row.authorId,
    authorName: deleted ? null : row.authorName,
    body: deleted ? "" : row.body,
    mentionedUserIds: deleted ? [] : row.mentionedUserIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // 저장 직후의 updatedAt은 createdAt과 같은 트랜잭션 시각이다. 그 뒤 실제로 고친 것만 "수정됨".
    edited: !deleted && row.updatedAt.getTime() > row.createdAt.getTime(),
    deleted,
  };
}

const selection = {
  id: termComments.id,
  termId: termComments.termId,
  parentId: termComments.parentId,
  authorId: termComments.authorId,
  body: termComments.body,
  mentionedUserIds: termComments.mentionedUserIds,
  createdAt: termComments.createdAt,
  updatedAt: termComments.updatedAt,
  deletedAt: termComments.deletedAt,
  authorName: users.name,
};

export async function listComments(termId: string): Promise<TermCommentWire[]> {
  const rows = await getDb()
    .select(selection)
    .from(termComments)
    .leftJoin(users, eq(users.id, termComments.authorId))
    .where(eq(termComments.termId, termId))
    .orderBy(asc(termComments.createdAt), asc(termComments.id));
  return rows.map(toWire);
}

async function loadComment(termId: string, id: string): Promise<CommentRow | null> {
  const [row] = await getDb()
    .select(selection)
    .from(termComments)
    .leftJoin(users, eq(users.id, termComments.authorId))
    .where(and(eq(termComments.id, id), eq(termComments.termId, termId)))
    .limit(1);
  return row ?? null;
}

/**
 * 본문에 적힌 멘션 중 실제 사용자만 색인에 남긴다. 본문 토큰은 누구나 손으로 쓸 수
 * 있어서(API 포함), 검증 없이 색인하면 없는 id나 탈퇴한 사람이 "멘션됨"으로 남는다.
 */
async function verifiedMentions(body: string): Promise<string[]> {
  const ids = mentionedUserIds(body);
  if (ids.length === 0) return [];
  const rows = await getDb().select({ id: users.id }).from(users).where(inArray(users.id, ids));
  const existing = new Set(rows.map((r) => r.id));
  return ids.filter((id) => existing.has(id));
}

export async function createComment(input: { termId: string; parentId?: string | null; body: string; author: CurrentUser }): Promise<CommentWriteResult> {
  if (input.parentId) {
    // 다른 용어의 댓글 id를 parentId로 넣으면 트리가 용어 경계를 넘는다. FK는 그걸 막지 못한다.
    const parent = await loadComment(input.termId, input.parentId);
    if (!parent) return { ok: false, code: "not_found", message: "답글을 달 댓글을 찾을 수 없습니다." };
    if (parent.deletedAt) return { ok: false, code: "validation_failed", message: "삭제된 댓글에는 답글을 달 수 없습니다." };
  }
  const [row] = await getDb()
    .insert(termComments)
    .values({
      termId: input.termId,
      parentId: input.parentId ?? null,
      authorId: input.author.id,
      body: input.body,
      mentionedUserIds: await verifiedMentions(input.body),
    })
    .returning();
  return { ok: true, comment: toWire({ ...row!, authorName: input.author.name }) };
}

export async function updateComment(input: { termId: string; id: string; body: string; user: CurrentUser }): Promise<CommentWriteResult> {
  const existing = await loadComment(input.termId, input.id);
  if (!existing || existing.deletedAt) return { ok: false, code: "not_found", message: "댓글을 찾을 수 없습니다." };
  // 관리자라도 남의 글을 고치지 않는다 — 이름이 그대로 붙은 채 내용이 바뀌면 그 사람이 한 말이 된다.
  if (existing.authorId !== input.user.id) return { ok: false, code: "forbidden", message: "본인이 쓴 댓글만 수정할 수 있습니다." };
  const [row] = await getDb()
    .update(termComments)
    .set({ body: input.body, mentionedUserIds: await verifiedMentions(input.body), updatedAt: new Date() })
    .where(eq(termComments.id, input.id))
    .returning();
  return { ok: true, comment: toWire({ ...row!, authorName: existing.authorName }) };
}

export async function deleteComment(input: { termId: string; id: string; user: CurrentUser }): Promise<CommentWriteResult> {
  const existing = await loadComment(input.termId, input.id);
  if (!existing || existing.deletedAt) return { ok: false, code: "not_found", message: "댓글을 찾을 수 없습니다." };
  if (existing.authorId !== input.user.id && input.user.role !== "admin") {
    return { ok: false, code: "forbidden", message: "본인이 쓴 댓글만 삭제할 수 있습니다." };
  }
  // 행을 지우면 FK cascade로 답글까지 사라진다. 본문만 비우고 자리를 남긴다.
  const [row] = await getDb()
    .update(termComments)
    .set({ body: "", mentionedUserIds: [], deletedAt: new Date() })
    .where(eq(termComments.id, input.id))
    .returning();
  return { ok: true, comment: toWire({ ...row!, authorName: null }) };
}
