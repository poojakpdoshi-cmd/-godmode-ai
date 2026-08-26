import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  listProviderConfigurations: vi.fn(),
  getProviderConfiguration: vi.fn(),
  upsertProviderConfiguration: vi.fn(),
  disableProviderConfiguration: vi.fn(),
};
const llm = { listLLMModels: vi.fn(), invokeLLM: vi.fn() };

vi.mock("./db", () => db);
vi.mock("./_core/llm", () => llm);
vi.mock("./providerSecrets", () => ({ decryptProviderKey: () => "safe-test-key", encryptProviderKey: () => "encrypted" }));

const registry = await import("./providerRegistry");

describe("verified registry cache", () => {
  beforeEach(() => {
    registry.clearModelRegistryCache();
    vi.restoreAllMocks();
    llm.listLLMModels.mockResolvedValue({ data: [{ id: "claude-haiku-4-5" }] });
    db.listProviderConfigurations.mockResolvedValue([{ providerId: "openrouter", isEnabled: "yes", credentialEncrypted: "cipher" }]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "cohere/north-mini-code:free", name: "Cohere", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } }] }), { status: 200 });
      return new Response("", { status: 200 });
    }));
  });

  it("reuses a verified registry instead of re-running discovery and eligibility checks within its TTL", async () => {
    await registry.getModelRegistry(912, { verifyOpenRouterAccess: true });
    await registry.getModelRegistry(912, { verifyOpenRouterAccess: true });
    expect(llm.listLLMModels).toHaveBeenCalledTimes(1);
    expect(db.listProviderConfigurations).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
