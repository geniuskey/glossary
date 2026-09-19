import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { processRagIndexQueue, queueAllRagTerms, scheduleRagIndexing } from "@/lib/rag/indexer";
import { processMeetingRagIndexQueue, queueAllMeetingDocuments, scheduleMeetingRagIndexing } from "@/lib/rag/meeting-indexer";
import { processWikiRagIndexQueue, queueAllWikiPages, scheduleWikiRagIndexing } from "@/lib/rag/wiki-indexer";
import { loadRagConfig } from "@/lib/rag/config";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const config = await loadRagConfig();
  if (!config.enabled) return apiError("rag_not_ready", "RAG 검색을 먼저 활성화해 주세요.", 503);
  const queued = await queueAllRagTerms();
  const queuedMeetings = await queueAllMeetingDocuments();
  const queuedWikiPages = await queueAllWikiPages();
  scheduleRagIndexing(8);
  scheduleMeetingRagIndexing(8);
  scheduleWikiRagIndexing(8);
  // In production the dedicated worker drains the durable queues. A small
  // synchronous pass gives tests immediate feedback without changing that boundary.
  if (process.env.NODE_ENV === "test") await processRagIndexQueue(1);
  if (process.env.NODE_ENV === "test") await processMeetingRagIndexQueue(1);
  if (process.env.NODE_ENV === "test") await processWikiRagIndexQueue(1);
  return Response.json({ ok: true, queued, queuedMeetings, queuedWikiPages }, { status: 202 });
});
