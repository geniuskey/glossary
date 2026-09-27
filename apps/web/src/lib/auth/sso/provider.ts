/** Pure provider helpers shared by server and client UI. */
export const GOOGLE_ISSUER = "https://accounts.google.com";

export function isGoogleIssuer(issuer: string): boolean {
  return issuer.trim().replace(/\/+$/, "").toLowerCase() === GOOGLE_ISSUER;
}

export function isGoogleOidc(provider: { issuer: string; protocol: string }): boolean {
  return provider.protocol === "oidc" && isGoogleIssuer(provider.issuer);
}
