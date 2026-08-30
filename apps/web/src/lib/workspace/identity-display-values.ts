export const IDENTITY_DISPLAY_LIMITS = { domain: 253, organization: 80 } as const;

export interface IdentityDisplaySettings {
  emailDomain: string;
  organization: string;
}

export const DEFAULT_IDENTITY_DISPLAY: IdentityDisplaySettings = {
  emailDomain: "",
  organization: "",
};

export function emailDomainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

/** 같은 회사 도메인만 조직명으로 축약하고, 예외 계정은 이메일을 남긴다. */
export function userDisplayLabel(
  user: { name: string; email: string },
  settings: IdentityDisplaySettings,
): string {
  const configuredDomain = settings.emailDomain.trim().toLowerCase();
  const organization = settings.organization.trim();
  if (configuredDomain && organization && emailDomainOf(user.email) === configuredDomain) {
    return `${user.name} · ${organization}`;
  }
  return `${user.name} · ${user.email}`;
}
