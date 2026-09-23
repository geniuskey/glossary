import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { isGlossarySnapshotBytes, isGlossarySnapshotText } from "@/lib/admin/term-snapshot-format";
import { parseGlossaryMatrix, parseGlossaryWorkbook } from "@/lib/import/parse-xlsx";
import { parseClipboardMatrix } from "@/lib/terms/grid";
import { listBusinessCategories } from "@/lib/terms/categories";
import { listDomains } from "@/lib/terms/domains";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/import/format";
import { prepareReview, reviewedInput, reviewRequestSchema } from "@/lib/import/prepare-review";
import { isSimpleGlossaryHeader, needsReview, reviewColumns } from "@/lib/import/review";
import { createTerm } from "@/lib/terms/create";
import { termInputSchema } from "@/lib/terms/schema";
import { updateTerm } from "@/lib/terms/update";
import { scheduleRagIndexing } from "@/lib/rag/indexer";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  // File plus editable review data. Each part also has an explicit limit below.
  if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES * 3) {
    return apiError("payload_too_large", "가져오기 요청이 너무 큽니다.", 413);
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return apiError("validation_failed", "form-data 형식이 필요합니다.", 400); }
  const file = form.get("file");
  const text = form.get("text");
  const review = form.get("review");
  if (typeof review !== "string" || new TextEncoder().encode(review).length > MAX_IMPORT_BYTES) {
    return apiError("validation_failed", "검토 데이터가 없거나 너무 큽니다.", 400);
  }
  let config;
  try { config = reviewRequestSchema.parse(JSON.parse(review)); }
  catch { return apiError("validation_failed", "검토 데이터 형식이 올바르지 않습니다.", 400); }
  const categories = (await listBusinessCategories()).map((c) => c.key);
  const domainLabels = (await listDomains()).map((d) => d.label);
  const columns = reviewColumns(config.columns);
  let parsed;
  try {
    if (file instanceof File) {
      if (file.size > MAX_IMPORT_BYTES) return apiError("payload_too_large", "파일이 10MB를 넘습니다.", 413);
      const bytes = await file.arrayBuffer();
      if (isGlossarySnapshotBytes(bytes)) {
        return apiError("validation_failed", "관리자용 용어집 스냅샷은 일반 가져오기에서 사용할 수 없습니다. 복원은 별도의 관리자 절차로 진행해야 합니다.", 400);
      }
      parsed = await parseGlossaryWorkbook(bytes, categories, columns.map((column) => column.key), domainLabels);
    } else if (typeof text === "string") {
      if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return apiError("payload_too_large", "붙여넣기 내용이 10MB를 넘습니다.", 413);
      if (isGlossarySnapshotText(text)) {
        return apiError("validation_failed", "관리자용 용어집 스냅샷은 일반 가져오기에서 사용할 수 없습니다. 복원은 별도의 관리자 절차로 진행해야 합니다.", 400);
      }
      const matrix = parseClipboardMatrix(text);
      if (matrix.length > MAX_IMPORT_ROWS + 1) return apiError("validation_failed", "최대 5000행까지 가져올 수 있습니다.", 400);
      let addedHeader = false;
      // Headerless paste in this explicit import flow means English / Korean.
      if (!isSimpleGlossaryHeader(matrix[0] ?? []) && form.get("hasHeaders") !== "true") {
        if (matrix.some((line) => line.length > columns.length || line.length < 2)) return apiError("validation_failed", `영문·한글 두 열은 필수입니다. 선택한 열 순서에 맞춰 붙여넣어 주세요: ${columns.map((column) => column.label).join(" → ")}`, 400);
        matrix.unshift(columns.map((column) => column.label));
        addedHeader = true;
      }
      parsed = parseGlossaryMatrix(matrix, categories, columns.map((column) => column.key), domainLabels);
      if (addedHeader) {
        parsed.rows.forEach((row) => { row.rowNumber -= 1; });
        parsed.errors.forEach((row) => { row.rowNumber -= 1; });
      }
    } else return apiError("validation_failed", "파일 또는 붙여넣기 내용이 필요합니다.", 400);
  } catch { return apiError("validation_failed", "파일 또는 표를 읽지 못했습니다. xlsx 형식과 내용을 확인해 주세요.", 400); }
  if (parsed.rows.length + parsed.errors.length > MAX_IMPORT_ROWS) return apiError("validation_failed", "최대 5000행까지 가져올 수 있습니다.", 400);
  let prepared;
  try { prepared = await prepareReview(parsed, config.options, config.decisions); }
  catch (error) {
    if (error instanceof Error && error.message === "검토 행 번호가 원본과 일치하지 않습니다.") return apiError("validation_failed", error.message, 400);
    throw error;
  }
  const { report, mapped } = prepared;
  if (form.get("apply") !== "true") return Response.json({ report });
  // Recompute from the original on every apply; changes to conflicts invalidate approvals.
  if (report.fileErrors.length || report.rows.some(needsReview)) return Response.json({ report, needsReview: true });
  const completed: number[] = [];
  const failures: { rowNumber: number; message: string }[] = [];
  let created = 0;
  let merged = 0;
  for (const row of mapped) {
    try {
      const input = prepared.inputs.get(row.rowNumber) ?? termInputSchema.parse(reviewedInput(row));
      const decision = report.rows.find((r) => r.rowNumber === row.rowNumber);
      if (decision?.mergeIntoTerm) {
        const result = await updateTerm(decision.mergeIntoTerm.id, input, auth.kind === "user" ? auth.user.id : null,
          decision.mergeIntoTerm.revision, auth.kind === "key" ? auth.keyId : null, `merged import row ${row.rowNumber}`);
        if (!("term" in result)) throw new Error("IMPORT_MERGE_CONFLICT");
        merged += 1;
      } else {
        await createTerm(input, auth.kind === "user" ? auth.user.id : null, auth.kind === "key" ? auth.keyId : null);
        created += 1;
      }
      completed.push(row.rowNumber);
      completed.push(...report.rows.filter((r) => !r.skip && r.mergeIntoRow === row.rowNumber).map((r) => r.rowNumber));
    } catch {
      // Report committed rows so retrying never silently resubmits the successful prefix.
      failures.push({ rowNumber: row.rowNumber, message: "저장하지 못했습니다. 실패한 행만 다시 시도해 주세요." });
      break;
    }
  }
  if (created > 0 || merged > 0) scheduleRagIndexing(8);
  return Response.json({ report, completed, failures, created, merged });
});
