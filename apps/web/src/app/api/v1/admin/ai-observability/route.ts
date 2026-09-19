import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getAiObservabilitySnapshot } from "@/lib/ai/telemetry";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getRagIndexStats } from "@/lib/rag/indexer";
import { loadRagConfig, publicRagConfig } from "@/lib/rag/config";
import { listReviewQueue } from "@/lib/ai/auto-review";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

const querySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
}).strict();

export const GET = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiError("validation_failed", "조회 기간은 1~720시간이어야 합니다.", 400);

  const [snapshot, aiConfig, ragConfig, ragStats, reviewQueue] = await Promise.all([
    getAiObservabilitySnapshot(parsed.data.hours),
    loadAiConfig(),
    loadRagConfig(),
    getRagIndexStats(),
    listReviewQueue(20),
  ]);
  return Response.json({
    snapshot,
    readiness: {
      ai: publicAiConfig(aiConfig),
      rag: publicRagConfig(ragConfig, ragStats),
    },
    queues: { rag: ragStats, review: reviewQueue },
  });
});
