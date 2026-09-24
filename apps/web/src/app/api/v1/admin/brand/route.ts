import { z } from "zod/v3";
import { workspaceBrandPresets } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getWorkspaceMenuSettings, saveWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const brandSchema = z.object({ preset: z.enum(workspaceBrandPresets) }).strict();

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  return Response.json({ preset: (await getWorkspaceMenuSettings()).brandPreset });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const parsed = brandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "대표 색을 확인해 주세요.", 400, parsed.error.flatten());
  const settings = await getWorkspaceMenuSettings();
  const saved = await saveWorkspaceMenuSettings({ ...settings, brandPreset: parsed.data.preset }, admin.id);
  return Response.json({ preset: saved.brandPreset });
});
