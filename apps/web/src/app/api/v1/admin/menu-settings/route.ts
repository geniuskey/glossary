import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getWorkspaceMenuSettings, saveWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const menuSettingsSchema = z.object({
  contribute: z.boolean(),
  "field-completion": z.boolean(),
  sheet: z.literal(true),
  classifications: z.boolean(),
  graph: z.boolean(),
  chat: z.boolean(),
  meetings: z.boolean(),
  wiki: z.boolean(),
  api: z.boolean(),
  import: z.boolean(),
  statistics: z.boolean(),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return Response.json({ settings: await getWorkspaceMenuSettings() });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = menuSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "메뉴 설정을 확인해 주세요.", 400, parsed.error.flatten());
  return Response.json({ settings: await saveWorkspaceMenuSettings(parsed.data, admin.id) });
});
