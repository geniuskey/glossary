import { expect, test } from "vitest";
import { planBulkRoleChange } from "../src/lib/admin/bulk-roles.js";

const SELF = "self";
const selected = [
  { id: SELF, role: "admin" as const, authType: "password" as const },
  { id: "viewer-1", role: "viewer" as const, authType: "sso" as const },
  { id: "editor-1", role: "editor" as const, authType: "sso" as const },
  { id: "agent-1", role: "editor" as const, authType: "agent" as const },
];

// 서버는 하나라도 걸리면 전체를 거절한다. 화면에서 미리 빼지 않으면 "전체 선택"이
// 본인이 섞였다는 이유만으로 매번 실패한다.
test("일괄 변경은 본인과 이미 그 역할인 사람을 빼고 보낸다", () => {
  expect(planBulkRoleChange(selected, "editor", SELF)).toEqual({
    ids: ["viewer-1"],
    skippedSelf: 1,
    skippedAgents: 0,
    unchanged: 2,
  });
});

test("관리자로 올릴 때만 에이전트를 뺀다", () => {
  expect(planBulkRoleChange(selected, "admin", SELF)).toEqual({
    ids: ["viewer-1", "editor-1"],
    skippedSelf: 1,
    skippedAgents: 1,
    unchanged: 0,
  });
  expect(planBulkRoleChange(selected, "viewer", SELF).ids).toEqual(["editor-1", "agent-1"]);
});
