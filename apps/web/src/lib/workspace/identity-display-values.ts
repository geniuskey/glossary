/** SSO가 확인한 그룹/조직을 표시하고, 로컬 계정은 이메일을 남긴다. */
export function userDisplayLabel(
  user: { name: string; email: string; ssoGroups: readonly string[] | null },
): string {
  const groups = user.ssoGroups?.map((group) => group.trim()).filter(Boolean) ?? [];
  if (groups.length > 0) return `${user.name} · ${groups.join(", ")}`;
  return `${user.name} · ${user.email}`;
}
