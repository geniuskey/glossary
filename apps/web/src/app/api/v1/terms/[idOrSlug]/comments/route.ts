import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { commentCreateSchema } from "@/lib/comments/schema";
import { createComment, listComments } from "@/lib/comments/store";
import { commentWriteResponse, requireCommentAuthor, resolveCommentTerm } from "@/lib/comments/route-helpers";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

type Context = { params: Promise<{ idOrSlug: string }> };

export const GET = withApiErrors(async (request: Request, ctx: Context) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const term = await resolveCommentTerm((await ctx.params).idOrSlug);
  if (isResponse(term)) return term;
  return Response.json({ comments: await listComments(term.id) });
});

export const POST = withApiErrors(async (request: Request, ctx: Context) => {
  const user = await requireCommentAuthor(request);
  if (isResponse(user)) return user;
  const limited = rateLimitResponse(await consumeRateLimit(`comment:user:${user.id}`, 30, 60_000), "잠시 후 다시 댓글을 남겨 주세요.");
  if (limited) return limited;
  const term = await resolveCommentTerm((await ctx.params).idOrSlug);
  if (isResponse(term)) return term;
  const parsed = commentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "댓글 내용을 확인해 주세요.", 400, parsed.error.flatten());
  return commentWriteResponse(await createComment({ termId: term.id, parentId: parsed.data.parentId, body: parsed.data.body, author: user }), 201);
});
