// 클라이언트(알림 메뉴)와 서버가 같이 쓰는 응답 타입. 서버 전용 모듈을 끌어오지 않도록 따로 둔다.

export type NotificationKind = "comment_mention" | "comment_reply";

export interface NotificationWire {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  actorName: string | null;
  excerpt: string;
  term: { slug: string; name: string };
  href: string;
}

export interface NotificationListResponse {
  items: NotificationWire[];
  unreadCount: number;
}

/**
 * 댓글 하나가 누구에게 어떤 알림을 만들어야 하는지. 한 사람에게는 하나만 간다 —
 * 답글에서 원 댓글 작성자를 멘션하는 일이 흔한데(답글 창이 기본으로 넣어 준다),
 * 그때 "언급했습니다"와 "답글을 달았습니다"가 둘 다 오면 같은 일로 두 번 울린다.
 * 멘션이 더 직접적인 부름이라 멘션을 남긴다.
 */
export function desiredCommentNotifications(input: {
  actorId: string;
  mentionedUserIds: readonly string[];
  parentAuthorId: string | null;
}): { userId: string; kind: NotificationKind }[] {
  const out = new Map<string, NotificationKind>();
  for (const id of input.mentionedUserIds) if (id !== input.actorId) out.set(id, "comment_mention");
  const parent = input.parentAuthorId;
  if (parent && parent !== input.actorId && !out.has(parent)) out.set(parent, "comment_reply");
  return [...out].map(([userId, kind]) => ({ userId, kind }));
}
