import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { apiError, methodNotAllowed } from "@/lib/api-error";

const ALLOWED_METHODS = ["GET"];

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return apiError("internal_error", "데이터베이스에 연결할 수 없습니다.", 503);
  }
}

export async function POST() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function PUT() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function PATCH() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function DELETE() {
  return methodNotAllowed(ALLOWED_METHODS);
}
