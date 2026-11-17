import { apiError } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import type { CommentWriteResult } from "./store";

/**
 * 댓글 쓰기는 "read" 범위로 받는다. 조회자(viewer)도 용어를 고칠 수는 없지만 토론에는
 * 낄 수 있어야 한다 — 그게 고칠 사람에게 고칠 거리를 알려 주는 통로다.
 * API 키는 거부한다. 키에는 사람이 없어서 작성자·멘션·수정 권한을 매길 수 없다.
 */
export async function requireCommentAuthor(request: Request): Promise<CurrentUser | Response> {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "댓글은 로그인한 사용자만 쓸 수 있습니다.", 403);
  return auth.user;
}

export async function resolveCommentTerm(idOrSlug: string): Promise<{ id: string } | Response> {
  const term = await getTermByIdOrSlug(idOrSlug);
  if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  return term;
}

export function commentWriteResponse(result: CommentWriteResult, status = 200): Response {
  if (!result.ok) return apiError(result.code, result.message, result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : 400);
  return Response.json({ comment: result.comment }, { status });
}
