import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { parseGlossaryWorkbook } from "@/lib/import/parse-xlsx";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/import/format";
import { applyImport, dryRunImport } from "@/lib/import/apply";

// R118: 이 라우트는 POST만 처리한다. 계획서 스케치는 이 export를 빠뜨렸다 —
// 이 저장소에서 다섯 번째로 반복되는 실수라고 브리핑이 지적한 바로 그 결함.
const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// R119: Content-Length가 MAX_IMPORT_BYTES를 넘으면 곧바로 거부한다. 실제 파일
// 크기와 달리 멀티파트 경계·필드 헤더만큼 살짝 부풀 수 있어 여유를 둔다
// (바이너리 파일 파트 자체는 base64로 부풀지 않는다).
const CONTENT_LENGTH_SLOP = 64 * 1024;

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  // R119: `request.formData()`는 호출하는 순간 본문 전체를 메모리에 올린다 —
  // 그 뒤에 `file.size > MAX_IMPORT_BYTES`를 검사하면(계획서 스케치) 이미 늦다.
  // xlsx는 압축률이 높아 20만 행이 10MB 안에 들어가므로, 상한이 장식이 되지 않으려면
  // 본문을 읽기 전에 걸러야 한다. Content-Length 헤더는 formData() 호출 전에도
  // 읽을 수 있는 유일한 크기 정보라 여기서 먼저 확인한다. (헤더가 없거나
  // 클라이언트가 거짓 값을 보내는 경우까지는 막지 못한다 — 그건 아래
  // file.size 검사가 두 번째 방어선이다. 표준 Fetch API에는 스트리밍 멀티파트
  // 파서가 없어 완전한 조기 차단은 이 플랫폼의 구조적 한계다.)
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES + CONTENT_LENGTH_SLOP) {
    return apiError("payload_too_large", "파일이 10MB를 넘습니다.", 413);
  }

  // R118: 본문이 multipart가 아니면 formData()가 던진다 — withApiErrors가
  // 감싸므로 500으로 새지는 않지만, 이건 재시도해도 절대 성공하지 않는
  // 영구적으로 잘못된 요청이라 400이 맞는 신호다(R41/R59와 같은 원칙).
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("validation_failed", "요청 본문이 올바른 form-data 형식이 아닙니다.", 400);
  }

  const file = form.get("file");
  const dryRun = form.get("dryRun") !== "false";

  if (!(file instanceof File)) {
    return apiError("validation_failed", "file 필드에 xlsx 파일이 필요합니다.", 400);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return apiError("payload_too_large", "파일이 10MB를 넘습니다.", 413);
  }

  const { rows, errors, fileErrors, ignoredHeaders } = await parseGlossaryWorkbook(await file.arrayBuffer());

  // R119: 행 수 상한. computeVerdict(apply.ts)가 findDuplicates를 행마다 부르지
  // 않도록 이미 배치로 바꿨지만, 그래도 상한 자체가 없으면 배치 쿼리 하나가
  // 무제한으로 커지는 IN 목록이 된다 — Postgres 플래너 성능과 요청 하나의
  // 메모리·시간을 모두 지키려면 명시적 상한이 필요하다.
  const totalRows = rows.length + errors.length;
  if (totalRows > MAX_IMPORT_ROWS) {
    return apiError(
      "validation_failed",
      `한 번에 가져올 수 있는 행은 최대 ${MAX_IMPORT_ROWS}개입니다. (${totalRows}행)`,
      400,
      { maxRows: MAX_IMPORT_ROWS, actual: totalRows },
    );
  }

  if (dryRun) {
    const report = await dryRunImport(rows, errors);
    return Response.json({ dryRun: true, report: { ...report, fileErrors, ignoredHeaders } });
  }

  const authorId = auth.kind === "user" ? auth.user.id : null;
  // R120: API 키로 인증된 요청은 authorId가 항상 null이라, authorKeyId를
  // 끝까지 넘겨야만 임포트로 만든 리비전에 작성자가 남는다.
  const authorKeyId = auth.kind === "key" ? auth.keyId : null;

  // R117: 화면이 충돌/파일 내 중복으로 걸린 행 중 사용자가 "그래도 등록"을
  // 고른 행 번호만 쉼표로 담아 보낸다(동음이의어 강제 등록). 형식이 이상한
  // 값은 조용히 무시한다 — 잘못 파싱된 행 번호가 강제 등록 대상에 실수로
  // 끼어드는 쪽보다 안전하다.
  const forceParam = form.get("force");
  const forceRowNumbers = new Set(
    typeof forceParam === "string"
      ? forceParam
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      : [],
  );

  const { created, skipped } = await applyImport(rows, authorId, authorKeyId, forceRowNumbers);
  return Response.json({ dryRun: false, created, skipped, parseErrors: errors, fileErrors, ignoredHeaders });
});
