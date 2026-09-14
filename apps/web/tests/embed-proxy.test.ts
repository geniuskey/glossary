import { afterEach, expect, test, vi } from "vitest";
import { proxy, config } from "../src/proxy";

afterEach(() => vi.unstubAllEnvs());
test("unset or empty embed origins allow embedding from any origin", () => {
  for (const value of [undefined, "", "  \n "]) {
    vi.stubEnv("GLOSSARY_EMBED_ANCESTORS", value);
    expect(proxy().headers.get("content-security-policy")).toBe("frame-ancestors *");
  }
});
test("embed headers read Confluence origins at runtime without widening normal page routes", () => {
  vi.stubEnv("GLOSSARY_EMBED_ANCESTORS", "https://confluence.example.com");
  expect(proxy().headers.get("content-security-policy")).toBe("frame-ancestors 'self' https://confluence.example.com");
  vi.stubEnv("GLOSSARY_EMBED_ANCESTORS", "https://wiki.example.org");
  expect(proxy().headers.get("content-security-policy")).toBe("frame-ancestors 'self' https://wiki.example.org");
  expect(config.matcher).toBe("/embed/:path*");
});
