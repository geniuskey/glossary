import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { isResponse } from "@/lib/auth/require";
import { commentUpdateSchema } from "@/lib/comments/schema";
import { deleteComment, updateComment } from "@/lib/comments/store";
import { commentWriteResponse, requireCommentAuthor, resolveCommentTerm } from "@/lib/comments/route-helpers";

const ALLOWED_METHODS = ["PATCH", "DELETE"];
const { GET, POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, OPTIONS };

type Context = { params: Promise<{ idOrSlug: string; commentId: string }> };

async function target(request: Request, ctx: Context) {
  const user = await requireCommentAuthor(request);
  if (isResponse(user)) return user;
  const params = await ctx.params;
  const id = requireUuid(params.commentId, "댓글을 찾을 수 없습니다.");
  if (isResponse(id)) return id;
  const term = await resolveCommentTerm(params.idOrSlug);
  if (isResponse(term)) return term;
  return { user, id, termId: term.id };
}

export const PATCH = withApiErrors(async (request: Request, ctx: Context) => {
  const t = await target(request, ctx);
  if (isResponse(t)) return t;
  const parsed = commentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "댓글 내용을 확인해 주세요.", 400, parsed.error.flatten());
  return commentWriteResponse(await updateComment({ ...t, body: parsed.data.body }));
});

export const DELETE = withApiErrors(async (request: Request, ctx: Context) => {
  const t = await target(request, ctx);
  if (isResponse(t)) return t;
  return commentWriteResponse(await deleteComment(t));
});
