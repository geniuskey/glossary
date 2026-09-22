import { z } from "zod/v3";
import { workspaceHomeModes } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getWorkspaceMenuSettings, saveWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const homeModeSchema = z.object({ mode: z.enum(workspaceHomeModes) }).strict();

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  return Response.json({ mode: (await getWorkspaceMenuSettings()).homeMode });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const parsed = homeModeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "홈 입력 방식을 확인해 주세요.", 400, parsed.error.flatten());
  const settings = await getWorkspaceMenuSettings();
  const saved = await saveWorkspaceMenuSettings({ ...settings, homeMode: parsed.data.mode }, admin.id);
  return Response.json({ mode: saved.homeMode });
});
