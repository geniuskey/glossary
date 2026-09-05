import { afterEach, expect, test } from "vitest";
import { aiEncryptionReady, decryptAiSecret, encryptAiSecret } from "../src/lib/ai/crypto.js";

const originalKey = process.env.GLOSSARY_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = originalKey;
});

test("AI 비밀값은 평문이 남지 않는 AES-GCM 문자열로 왕복한다", () => {
  process.env.GLOSSARY_ENCRYPTION_KEY = "test-only-encryption-key-with-at-least-32-characters";
  const encrypted = encryptAiSecret("super-secret-api-key");
  expect(aiEncryptionReady()).toBe(true);
  expect(encrypted).toMatch(/^v1\./);
  expect(encrypted).not.toContain("super-secret-api-key");
  expect(decryptAiSecret(encrypted)).toBe("super-secret-api-key");
});

test("다른 암호화 키나 훼손된 암호문으로는 복호화되지 않는다", () => {
  process.env.GLOSSARY_ENCRYPTION_KEY = "first-test-encryption-key-with-at-least-32-characters";
  const encrypted = encryptAiSecret("secret");
  process.env.GLOSSARY_ENCRYPTION_KEY = "second-test-encryption-key-with-at-least-32-characters";
  expect(() => decryptAiSecret(encrypted)).toThrow();
  expect(() => decryptAiSecret("plain-text")).toThrow();
});

test("32자 미만 키로는 비밀값을 저장하지 않는다", () => {
  process.env.GLOSSARY_ENCRYPTION_KEY = "too-short";
  expect(aiEncryptionReady()).toBe(false);
  expect(() => encryptAiSecret("secret")).toThrow(/32자/);
});
