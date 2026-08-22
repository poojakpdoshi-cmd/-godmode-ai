import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";

function key() {
  if (!ENV.cookieSecret) throw new Error("Secure credential storage is unavailable because the server secret is missing.");
  return createHash("sha256").update(ENV.cookieSecret).digest();
}

export function encryptProviderKey(value: string) {
  const apiKey = value.trim();
  if (!apiKey) throw new Error("An API key is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptProviderKey(sealed: string) {
  const [ivValue, tagValue, ciphertextValue] = sealed.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Stored provider credential is invalid.");
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored provider credential could not be opened.");
  }
}
