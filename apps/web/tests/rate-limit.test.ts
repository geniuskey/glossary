import { afterEach, expect, test, vi } from "vitest";
import { clientAddress, consumeAddressRateLimit, UNKNOWN_CLIENT_ADDRESS } from "../src/lib/rate-limit.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(headers: Record<string, string>) {
  return new Request("http://x/api/v1/auth/login", { method: "POST", headers });
}

test("프록시 헤더를 믿지 않으면 헤더가 있어도 주소를 모른다고 본다", () => {
  vi.stubEnv("GLOSSARY_TRUST_PROXY_HEADERS", "false");

  expect(clientAddress(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" }))).toBe(UNKNOWN_CLIENT_ADDRESS);
});

test("X-Real-IP를 X-Forwarded-For보다 먼저 쓴다", () => {
  vi.stubEnv("GLOSSARY_TRUST_PROXY_HEADERS", "true");

  expect(clientAddress(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 203.0.113.9" }))).toBe("203.0.113.9");
});

// nginx는 클라이언트가 보낸 X-Forwarded-For 뒤에 자기가 본 주소를 덧붙인다. 첫 값을 쓰면
// 요청마다 첫 값을 바꿔 주소별 한도를 끝없이 피할 수 있다.
test("X-Forwarded-For는 클라이언트가 위조할 수 있는 첫 값이 아니라 마지막 값을 쓴다", () => {
  vi.stubEnv("GLOSSARY_TRUST_PROXY_HEADERS", "true");

  expect(clientAddress(request({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
});

test("Cloudflare 주소가 있으면 그것을 쓴다", () => {
  vi.stubEnv("GLOSSARY_TRUST_PROXY_HEADERS", "true");

  expect(clientAddress(request({ "cf-connecting-ip": "192.0.2.7", "x-real-ip": "203.0.113.9" }))).toBe("192.0.2.7");
});

// 주소를 모를 때 "direct" 버킷 하나를 모두가 나눠 쓰면, 한 사람이 한도만큼 보내서
// 전체 로그인을 잠글 수 있다. 이때는 버킷을 아예 건드리지 않는다(DB 호출도 없다).
test("주소를 모르면 주소별 한도를 적용하지 않는다", async () => {
  vi.stubEnv("GLOSSARY_TRUST_PROXY_HEADERS", "false");

  await expect(consumeAddressRateLimit(request({}), "auth:login", 0, 60_000)).resolves.toEqual({
    allowed: true,
    retryAfterSeconds: 0,
  });
});
