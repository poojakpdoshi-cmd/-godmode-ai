import { afterEach, describe, expect, it, vi } from "vitest";

const originalSecret = process.env.JWT_SECRET;

afterEach(() => {
  process.env.JWT_SECRET = originalSecret;
  vi.resetModules();
});

describe("encrypted user provider credentials", () => {
  it("round-trips a provider key without storing the plaintext representation", async () => {
    process.env.JWT_SECRET = "test-chat-encryption-secret";
    vi.resetModules();
    const { decryptProviderKey, encryptProviderKey } = await import("./providerSecrets");
    const sealed = encryptProviderKey("sk-openrouter-private-value");
    expect(sealed).not.toContain("sk-openrouter-private-value");
    expect(decryptProviderKey(sealed)).toBe("sk-openrouter-private-value");
  });

  it("rejects a tampered stored credential", async () => {
    process.env.JWT_SECRET = "test-chat-encryption-secret";
    vi.resetModules();
    const { decryptProviderKey, encryptProviderKey } = await import("./providerSecrets");
    const sealed = encryptProviderKey("sk-openrouter-private-value");
    expect(() => decryptProviderKey(`${sealed}tampered`)).toThrow("could not be opened");
  });
});
