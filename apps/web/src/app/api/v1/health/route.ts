import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return apiError("internal_error", "데이터베이스에 연결할 수 없습니다.", 503);
  }
}
