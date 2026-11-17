import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notifications, termComments, terms, users, type Db } from "@glossary/db";
import { getDb } from "@/lib/db";
import { parseCommentBody } from "@/lib/comments/mentions";
import { displayName } from "@/lib/ui/format";
import { desiredCommentNotifications, type NotificationWire } from "./wire";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const EXCERPT_MAX = 120;

export function commentExcerpt(body: string): string {
  const plain = parseCommentBody(body)
    .map((s) => (s.kind === "text" ? s.text : `@${s.name}`))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > EXCERPT_MAX ? `${plain.slice(0, EXCERPT_MAX - 1)}…` : plain;
}

/**
 * 댓글의 멘션·부모 작성자와 알림을 맞춘다. 댓글 쓰기와 같은 트랜잭션에서 부른다 — 따로
 * 돌면 댓글은 저장됐는데 알림이 없는(또는 그 반대) 상태가 에러 없이 남는다.
 *
 * 수정으로 멘션에서 빠진 사람의 알림은 지운다. 남겨 두면 눌러 들어가도 자기 이름이
 * 없는 댓글을 보게 된다. 이미 받은 알림은 onConflictDoNothing으로 건너뛰어, 오탈자
 * 하나 고칠 때마다 다시 "안 읽음"이 되지 않게 한다. 같은 사람의 알림 종류만 바뀌는
 * 경우(멘션을 지워 답글 알림이 되는 경우)도 읽음 상태를 이어받는다 — 같은 댓글이다.
 */
export async function syncCommentNotifications(
  tx: Tx,
  input: { commentId: string; termId: string; actorId: string; mentionedUserIds: readonly string[]; parentAuthorId: string | null },
): Promise<void> {
  const desired = desiredCommentNotifications(input);
  const existing = await tx
    .select({ id: notifications.id, userId: notifications.userId, kind: notifications.kind, readAt: notifications.readAt })
    .from(notifications)
    .where(eq(notifications.commentId, input.commentId));
  const wanted = new Set(desired.map((d) => `${d.userId}:${d.kind}`));
  const stale = existing.filter((row) => !wanted.has(`${row.userId}:${row.kind}`)).map((row) => row.id);
  if (stale.length) await tx.delete(notifications).where(inArray(notifications.id, stale));
  if (desired.length === 0) return;
  await tx
    .insert(notifications)
    .values(desired.map(({ userId, kind }) => ({
      userId, kind, termId: input.termId, commentId: input.commentId, actorId: input.actorId,
      readAt: existing.find((row) => row.userId === userId)?.readAt ?? null,
    })))
    .onConflictDoNothing();
}

const actors = alias(users, "notification_actor");

export async function listNotifications(userId: string, limit = 20): Promise<{ items: NotificationWire[]; unreadCount: number }> {
  const db = getDb();
  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
        commentId: notifications.commentId,
        body: termComments.body,
        termSlug: terms.slug,
        termNameEn: terms.nameEn,
        termNameKo: terms.nameKo,
        actorName: actors.name,
      })
      .from(notifications)
      .innerJoin(termComments, eq(termComments.id, notifications.commentId))
      .innerJoin(terms, eq(terms.id, notifications.termId))
      .leftJoin(actors, eq(actors.id, notifications.actorId))
      .where(and(eq(notifications.userId, userId), isNull(termComments.deletedAt)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit),
    db
      .select({ n: count() })
      .from(notifications)
      .innerJoin(termComments, eq(termComments.id, notifications.commentId))
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(termComments.deletedAt))),
  ]);
  return {
    unreadCount: unread?.n ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
      actorName: row.actorName,
      excerpt: commentExcerpt(row.body),
      term: { slug: row.termSlug, name: displayName({ slug: row.termSlug, nameEn: row.termNameEn, nameKo: row.termNameKo }) },
      href: `/g/${row.termSlug}#comment-${row.commentId}`,
    })),
  };
}

/** ids를 주지 않으면 전부 읽음으로 한다. 다른 사람의 알림 id는 userId 조건에서 걸러진다. */
export async function markNotificationsRead(userId: string, ids?: readonly string[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const rows = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
      ...(ids ? [inArray(notifications.id, [...ids])] : []),
    ))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function clearCommentNotifications(tx: Tx, commentId: string): Promise<void> {
  await tx.delete(notifications).where(eq(notifications.commentId, commentId));
}
