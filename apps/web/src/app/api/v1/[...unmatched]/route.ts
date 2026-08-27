import { apiError } from "@/lib/api-error";

// 매칭되지 않는 /api/v1/* 경로는 Next 기본 HTML 404를 반환한다.
// AI-Lint 같은 기계 클라이언트가 오타 난 경로를 때렸을 때 JSON 대신 HTML을 파싱하게 되므로
// "모든 API 에러는 { error: { code, message } }"라는 규약에 구멍이 생긴다. 여기서 막는다.
function notFound(): Response {
  return apiError("not_found", "요청한 경로를 찾을 수 없습니다.", 404);
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
