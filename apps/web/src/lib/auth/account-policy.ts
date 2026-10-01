import { createHash } from "node:crypto";
import { isNotNull, or } from "drizzle-orm";
import { users } from "@glossary/db";

/** API-only accounts cannot sign in to administer the application. */
export function interactiveAccountCondition() {
  return or(isNotNull(users.passwordHash), isNotNull(users.externalId));
}

export function ssoSubjectHash(subject: string): string {
  return createHash("sha256").update(subject).digest("hex");
}
