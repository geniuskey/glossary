import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { enforceCsrf, isAllowedCsrfOrigin } from "../src/lib/auth/csrf.js";

const originalOrigins = process.env.GLOSSARY_ALLOWED_ORIGINS;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalOrigins === undefined) delete process.env.GLOSSARY_ALLOWED_ORIGINS;
  else process.env.GLOSSARY_ALLOWED_ORIGINS = originalOrigins;
});

test("안전한 메서드는 CSRF 토큰이 없어도 통과한다", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(enforceCsrf(new Request("https://glossary.example.com/api", { method: "GET" }))).toBeNull();
});

test("빠른 시작 환경 예제는 로컬 요청과 같은 origin을 허용한다", () => {
  const example = readFileSync(path.resolve(import.meta.dirname, "../../../.env.example"), "utf8");
  expect(example).toMatch(/^GLOSSARY_ALLOWED_ORIGINS=\s*$/m);

  process.env.GLOSSARY_ALLOWED_ORIGINS = "";
  const request = new Request("http://localhost:3000/api/v1/setup", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
  expect(isAllowedCsrfOrigin(request, "http://localhost:3000")).toBe(true);
});

test("변경 요청은 허용 origin과 일치하는 Origin만 통과한다", () => {
  vi.stubEnv("NODE_ENV", "production");
  process.env.GLOSSARY_ALLOWED_ORIGINS = "https://glossary.example.com, https://admin.example.com";

  const sameOrigin = new Request("https://glossary.example.com/api", {
    method: "POST",
    headers: { origin: "https://glossary.example.com" },
  });
  const crossOrigin = new Request("https://glossary.example.com/api", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });

  expect(isAllowedCsrfOrigin(sameOrigin, "https://glossary.example.com")).toBe(true);
  expect(enforceCsrf(sameOrigin)).toBeNull();
  expect(enforceCsrf(crossOrigin)?.status).toBe(403);
});

test("Origin이 없으면 같은 출처 Referer를 대체 증거로 사용한다", () => {
  vi.stubEnv("NODE_ENV", "production");
  process.env.GLOSSARY_ALLOWED_ORIGINS = "https://glossary.example.com";
  const request = new Request("https://glossary.example.com/api", {
    method: "PATCH",
    headers: { referer: "https://glossary.example.com/settings/profile" },
  });
  expect(enforceCsrf(request)).toBeNull();
});
