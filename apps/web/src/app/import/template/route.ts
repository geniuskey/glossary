import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TEMPLATE_FILENAME } from "@/lib/import/format";
import { buildImportTemplate } from "@/lib/import/template";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 샘플 xlsx 내려받기. /api/v1 밑이 아니라 화면 옆에 두는 이유가 둘 있다.
 *
 * 하나, 이건 AI-Lint 통합이 부를 공개 API가 아니라 이 화면의 부속품이다 —
 * /api/v1에 두면 OpenAPI 계약(R129)에 실려 외부 약속이 되어버린다.
 * 둘, 화면에서 그냥 <a href>로 걸 수 있어야 하는데 /api/로 향하는 href는
 * PROTO A(R95)가 금지한다 — 파일 내려받기는 CSRF와 무관하지만 그 규칙은
 * 예외를 두는 순간 무의미해지므로, 규칙을 피해 가는 대신 경로를 옮긴다.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const buffer = await buildImportTemplate();

  return new Response(buffer, {
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": `attachment; filename="${TEMPLATE_FILENAME}"`,
      // 파일 내용은 format.ts가 바뀔 때만 바뀐다. 그래도 브라우저가 옛 샘플을
      // 계속 주면 "설명은 새 열을 말하는데 받은 파일에는 없는" 상태가 되므로
      // 캐시하지 않는다 — 요청 수가 문제 될 만한 경로가 아니다.
      "cache-control": "no-store",
    },
  });
}
