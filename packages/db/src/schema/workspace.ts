import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

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
    // 이전 버전의 고정 담당자 표시 설정. 기존 설치의 데이터를 파괴하지 않기 위해
    // 컬럼은 유지하지만 화면과 조회에서는 더 이상 사용하지 않는다.
    memberEmailDomain: text("member_email_domain"),
    memberOrganization: text("member_organization"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({ singleRow: check("workspace_settings_single_row", sql`${t.id} = 'default'`) }),
);
