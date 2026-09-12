import { expect, test } from "vitest";
import { isUniqueViolation } from "../src/lib/postgres-error";

test("recognizes direct and Drizzle-wrapped unique violations without swallowing unrelated errors", () => {
  const driver = { code: "23505", constraint_name: "terms_slug_unique" };
  expect(isUniqueViolation(driver, ["terms_slug_unique"])).toBe(true);
  expect(isUniqueViolation(new Error("query failed", { cause: driver }), ["terms_slug_unique"])).toBe(true);
  expect(isUniqueViolation(new Error("query failed", { cause: driver }), ["users_email_unique"])).toBe(false);
  expect(isUniqueViolation({ code: "23503", constraint_name: "terms_slug_unique" }, ["terms_slug_unique"])).toBe(false);
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  expect(isUniqueViolation(cycle, ["terms_slug_unique"])).toBe(false);
});
