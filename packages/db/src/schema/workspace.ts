import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** 사이드바에서 관리자가 표시 여부를 조정할 수 있는 부가 메뉴. 시트는 항상 표시한다. */
export const workspaceMenuKeys = [
  "contribute",
  "check",
  "field-completion",
  "sheet",
  "classifications",
  "graph",
  "chat",
  "meetings",
  "wiki",
  "api",
  "import",
  "statistics",
] as const;

export type WorkspaceMenuKey = (typeof workspaceMenuKeys)[number];
export const workspaceHomeModes = ["search", "chat"] as const;
export type WorkspaceHomeMode = (typeof workspaceHomeModes)[number];
/** 설치 단위 대표 색. 상태색(ok/warn/danger/info)과 겹치지 않는 조합만 둔다. */
export const workspaceBrandPresets = ["navy", "ink", "teal"] as const;
export type WorkspaceBrandPreset = (typeof workspaceBrandPresets)[number];
export type WorkspaceMenuSettings = Partial<Record<WorkspaceMenuKey, boolean>> & {
  order?: WorkspaceMenuKey[];
  homeMode?: WorkspaceHomeMode;
  brandPreset?: WorkspaceBrandPreset;
};

/**
 * 설치 단위 전체에 적용되는 표시 설정. 홈 첫 화면 문구와 구성원 표시 정책을
 * 행을 기능별로 흩뜨리지 않도록 워크스페이스 단위의 단일 행으로 둔다.
 */
export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    id: text("id").primaryKey().default("default"),
    homeEyebrow: text("home_eyebrow").notNull(),
    homeTitle: text("home_title").notNull(),
    homeDescription: text("home_description").notNull(),
    definitionMinChars: integer("definition_min_chars").notNull().default(1),
    bodyMinChars: integer("body_min_chars").notNull().default(0),
    menuSettings: jsonb("menu_settings").$type<WorkspaceMenuSettings>().notNull().default(sql`'{}'::jsonb`),
    // 이전 버전의 고정 담당자 표시 설정. 기존 설치의 데이터를 파괴하지 않기 위해
    // 컬럼은 유지하지만 화면과 조회에서는 더 이상 사용하지 않는다.
    memberEmailDomain: text("member_email_domain"),
    memberOrganization: text("member_organization"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    singleRow: check("workspace_settings_single_row", sql`${t.id} = 'default'`),
    definitionMinCharsRange: check("workspace_settings_definition_min_chars_range", sql`${t.definitionMinChars} between 0 and 10000`),
    bodyMinCharsRange: check("workspace_settings_body_min_chars_range", sql`${t.bodyMinChars} between 0 and 10000`),
  }),
);
