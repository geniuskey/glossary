import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { chatConversations } from "@glossary/db";
import { getDb } from "@/lib/db";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { updateTerm } from "@/lib/terms/update";
import { domainsExist } from "@/lib/terms/domains";
import { businessCategoriesExist } from "@/lib/terms/categories";
import { chatEditPatchSchema } from "@/lib/ai/chat-edit-schema";
import type { StoredChatMessage } from "@/lib/ai/chat-history-values";
import { prepareAutoReview } from "@/lib/ai/auto-review";
import { scheduleAfterResponse } from "@/lib/after-response";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };
const schema = z.object({ sessionId: z.string().uuid(), actionId: z.string().uuid(), action: z.enum(["apply", "cancel"]) }).strict();
class ActionChanged extends Error {}

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "내 대화에서만 수정안을 적용할 수 있습니다.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "수정안을 확인해 주세요.", 400);
  const { sessionId, actionId, action } = parsed.data;
  const owned = and(eq(chatConversations.id, sessionId), eq(chatConversations.userId, auth.user.id));
  const readProposal = async () => {
    const [row] = await getDb().select().from(chatConversations).where(owned);
    return (row?.messages as StoredChatMessage[] | undefined)?.find((message) => message.edit?.id === actionId)?.edit;
  };
  const proposal = await readProposal();
  if (!proposal) return apiError("not_found", "수정안을 찾을 수 없습니다.", 404);
  if (proposal.status !== "pending") return Response.json({ edit: proposal });
  const patch = chatEditPatchSchema.safeParse(proposal.patch);
  if (!patch.success) return apiError("validation_failed", "수정안이 유효하지 않습니다. 새 수정안을 요청해 주세요.", 400);
  const finish = (status: "applied" | "cancelled", revision?: number) => ({ ...proposal, status, ...(revision ? { appliedRevision: revision } : {}) });
  const saveReceipt = async (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], status: "applied" | "cancelled", revision?: number) => {
    const [row] = await tx.select().from(chatConversations).where(owned).for("update");
    const messages = row?.messages as StoredChatMessage[] | undefined;
    if (!messages?.some((message) => message.edit?.id === actionId && message.edit.status === "pending")) throw new ActionChanged();
    await tx.update(chatConversations).set({
      messages: messages.map((message) => message.edit?.id === actionId ? { ...message, edit: finish(status, revision) } : message),
      updatedAt: new Date(),
    }).where(owned);
  };
  try {
    if (action === "cancel") {
      await getDb().transaction((tx) => saveReceipt(tx, "cancelled"));
      return Response.json({ edit: finish("cancelled") });
    }
    if (patch.data.domain && !await domainsExist(patch.data.domain) || patch.data.category && !await businessCategoriesExist(patch.data.category)) {
      return apiError("validation_failed", "분류 체계가 변경되었습니다. 새 수정안을 요청해 주세요.", 400);
    }
    const result = await updateTerm(proposal.termId, patch.data, auth.user.id, proposal.expectedRevision, null,
      `chat:${actionId} · ${proposal.reason}`, (tx, revision) => saveReceipt(tx, "applied", revision));
    if ("conflict" in result) {
      const current = await readProposal();
      if (current?.status === "applied") return Response.json({ edit: current });
      return apiError("revision_conflict", "다른 수정이 먼저 반영되었습니다. 최신 내용을 기준으로 새 수정안을 요청해 주세요.", 409);
    }
    if ("notFound" in result) return apiError("term_not_found", "용어가 삭제되었습니다.", 404);
    if ("invalid" in result) return apiError("validation_failed", result.issues.join(" "), 400);
    if ("representativeConflict" in result || "slugConflict" in result) return apiError("validation_failed", "기존 용어와 표기가 충돌합니다. 수정안을 다시 요청해 주세요.", 400);
    scheduleAfterResponse(() => prepareAutoReview(result.term.id));
    return Response.json({ edit: finish("applied", proposal.expectedRevision + 1), warnings: result.warnings });
  } catch (error) {
    if (!(error instanceof ActionChanged)) throw error;
    const current = await readProposal();
    return current ? Response.json({ edit: current }) : apiError("not_found", "대화가 삭제되어 수정을 적용하지 않았습니다.", 404);
  }
});
