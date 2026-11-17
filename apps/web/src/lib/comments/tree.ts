// 댓글 목록을 화면용 트리로 접는 순수 함수. 클라이언트와 서버가 같이 쓴다.

export const COMMENT_BODY_MAX = 4000;

export interface TermCommentWire {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
}

export interface CommentNode extends TermCommentWire {
  replies: CommentNode[];
}

/**
 * 삭제된 댓글은 살아 있는 답글이 아래에 있을 때만 "삭제된 댓글입니다" 자리로 남긴다.
 * 그런 답글이 없으면 빈 자리만 남아 토론이 끊긴 것처럼 보인다.
 *
 * 부모를 찾지 못한 댓글은 맨 위로 올린다. 부모는 FK cascade로 같이 사라지므로
 * 정상적으로는 없지만, 목록이 잘린 경우에도 답글이 통째로 사라지면 안 된다.
 */
export function buildCommentTree(comments: readonly TermCommentWire[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  for (const comment of comments) nodes.set(comment.id, { ...comment, replies: [] });
  const roots: CommentNode[] = [];
  const ordered = [...nodes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const node of ordered) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent && parent !== node ? parent.replies : roots).push(node);
  }
  const prune = (list: CommentNode[]): CommentNode[] =>
    list.flatMap((node) => {
      node.replies = prune(node.replies);
      return node.deleted && node.replies.length === 0 ? [] : [node];
    });
  return prune(roots);
}

export function countVisibleComments(nodes: readonly CommentNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.deleted ? 0 : 1) + countVisibleComments(node.replies), 0);
}
