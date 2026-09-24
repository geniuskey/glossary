import { z } from "zod/v3";
import { workspaceBrandPresets, workspaceHomeModes, workspaceMenuKeys } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getWorkspaceMenuSettings, saveWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const menuSettingsSchema = z.object({
  contribute: z.boolean(),
  check: z.boolean(),
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
  // Older clients may not know about the home input mode. Preserve the
  // existing value when they update only sidebar visibility/order.
  homeMode: z.enum(workspaceHomeModes).optional(),
  // 메뉴 화면은 설정 객체 전체를 되돌려 보낸다. strict 스키마에 빠져 있으면
  // 대표 색이 추가된 뒤로 메뉴 저장이 전부 400이 된다.
  brandPreset: z.enum(workspaceBrandPresets).optional(),
  order: z.array(z.enum(workspaceMenuKeys)).length(workspaceMenuKeys.length).refine(
    (value) => new Set(value).size === workspaceMenuKeys.length,
    "메뉴 순서에는 모든 메뉴가 한 번씩 포함되어야 합니다.",
  ),
}).strict();

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  return Response.json({ settings: await getWorkspaceMenuSettings() });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const parsed = menuSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "메뉴 설정을 확인해 주세요.", 400, parsed.error.flatten());
  const current = await getWorkspaceMenuSettings();
  return Response.json({ settings: await saveWorkspaceMenuSettings({ ...current, ...parsed.data }, admin.id) });
});
