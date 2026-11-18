import type { ManagedUser, ManagedUserRole } from "@/lib/admin/users";

export interface BulkRolePlan {
  /** 서버로 보낼 id. 이미 그 역할인 사람은 뺀다 — 바뀐 것이 없는데 감사 로그만 쌓이지 않게. */
  ids: string[];
  skippedSelf: number;
  skippedAgents: number;
  unchanged: number;
}

/**
 * 선택 목록에서 서버가 거절할 대상을 미리 뺀다. 서버는 하나라도 걸리면 전체를
 * 거절하므로(changeManagedUserRoles), 여기서 빼지 않으면 "전체 선택 → 뷰어"가
 * 본인이 섞여 있다는 이유만으로 매번 실패한다.
 */
export function planBulkRoleChange(
  selected: readonly Pick<ManagedUser, "id" | "role" | "authType">[],
  role: ManagedUserRole,
  viewerId: string,
): BulkRolePlan {
  const plan: BulkRolePlan = { ids: [], skippedSelf: 0, skippedAgents: 0, unchanged: 0 };
  for (const user of selected) {
    if (user.id === viewerId) plan.skippedSelf += 1;
    else if (role === "admin" && user.authType === "agent") plan.skippedAgents += 1;
    else if (user.role === role) plan.unchanged += 1;
    else plan.ids.push(user.id);
  }
  return plan;
}
