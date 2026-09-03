import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function key(): Buffer {
  const secret = process.env.GROSSARY_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("GROSSARY_ENCRYPTION_KEY는 32자 이상으로 설정해야 합니다.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function aiEncryptionReady(): boolean {
  return (process.env.GROSSARY_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function encryptAiSecret(value: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptAiSecret(value: string): string {
  if (!value) return "";
  const [version, ivRaw, tagRaw, encryptedRaw, extra] = value.split(".");
  if (version !== PREFIX || !ivRaw || !tagRaw || !encryptedRaw || extra !== undefined) {
    throw new Error("저장된 AI 비밀값 형식이 올바르지 않습니다.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
