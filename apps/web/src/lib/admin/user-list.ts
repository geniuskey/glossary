import type { ManagedUser, ManagedUserRole } from "@/lib/admin/users";

export const ROLE_LABEL: Record<ManagedUserRole, string> = { admin: "관리자", editor: "편집자", viewer: "뷰어" };
export const AUTH_TYPE_LABEL: Record<ManagedUser["authType"], string> = { password: "비밀번호", sso: "외부 계정", agent: "에이전트 API" };
export const USERS_PAGE_SIZE = 50;

export interface UserListFilter {
  query: string;
  role: ManagedUserRole | "all";
  authType: ManagedUser["authType"] | "all";
}

type FilterableUser = Pick<ManagedUser, "name" | "email" | "organization" | "role" | "authType">;

export function filterManagedUsers<T extends FilterableUser>(users: readonly T[], filter: UserListFilter): T[] {
  const query = filter.query.trim().toLocaleLowerCase("ko-KR");
  return users.filter((user) =>
    (filter.role === "all" || user.role === filter.role)
    && (filter.authType === "all" || user.authType === filter.authType)
    && (!query || `${user.name} ${user.email} ${user.organization ?? ""}`.toLocaleLowerCase("ko-KR").includes(query)));
}

export function pageOf<T>(items: readonly T[], page: number, size = USERS_PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages };
}

/**
 * 선택은 검색·필터·페이지를 바꿔도 유지한다(여러 번 검색해 모아 고르는 흐름).
 * 대신 지금 화면에 없는 선택 수를 따로 세어 일괄 변경 바와 확인 창에 드러낸다 —
 * 그러지 않으면 보이지 않는 사람까지 조용히 바뀐다.
 */
export function hiddenSelectionCount(selectedIds: ReadonlySet<string>, visibleIds: readonly string[]): number {
  const visible = new Set(visibleIds);
  let hidden = 0;
  for (const id of selectedIds) if (!visible.has(id)) hidden += 1;
  return hidden;
}

/**
 * 개별 역할 변경은 모든 방향에서 확인을 받는다. 승격은 강등보다 위험하다 —
 * 셀렉트를 잘못 건드린 것만으로 사용자 관리·AI 비밀값·동기화 권한이 열린다.
 */
export function roleChangeConfirmMessage(displayName: string, from: ManagedUserRole, to: ManagedUserRole): string {
  if (to === "admin") {
    return `${displayName} 사용자를 관리자로 지정할까요?\n관리자는 사용자 역할, 로그인 방식, AI 연결 비밀값과 서버 동기화를 모두 바꿀 수 있습니다.`;
  }
  if (from === "admin") return `${displayName} 사용자의 관리자 권한을 해제하고 ${ROLE_LABEL[to]}로 변경할까요?`;
  return `${displayName} 사용자를 ${ROLE_LABEL[to]}로 변경할까요?`;
}
