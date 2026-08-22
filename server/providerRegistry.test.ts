import { describe, expect, it } from "vitest";
import { buildProviderCompletionPayload, CallableModel, describeProviderRequestFailure, describeProviderTransportFailure, isVerifiedFreeOpenRouterModel, prioritizeFastFreeModels, ProviderDiagnostic, retainCallableModels, selectManagedFastModels } from "./providerRegistry";

const models: CallableModel[] = [
  { key: "platform:callable", providerId: "platform", providerName: "Platform catalog", modelId: "callable", displayName: "Callable", supportsTools: false, supportsVision: false, inputTypes: ["text"] },
  { key: "openrouter:blocked", providerId: "openrouter", providerName: "OpenRouter", modelId: "blocked", displayName: "Blocked", supportsTools: false, supportsVision: false, inputTypes: ["text"] },
];

describe("configured model registry", () => {
  it("returns only models from providers that are both configured and healthy", () => {
    const diagnostics: ProviderDiagnostic[] = [
      { providerId: "platform", providerName: "Platform catalog", configured: true, healthy: true, modelCount: 1, checkedAt: Date.now() },
      { providerId: "openrouter", providerName: "OpenRouter", configured: true, healthy: false, modelCount: 0, checkedAt: Date.now(), error: "Discovery failed" },
    ];
    expect(retainCallableModels(models, diagnostics)).toEqual([models[0]]);
  });

  it("turns an OpenRouter credit rejection into a concise action without showing raw JSON", () => {
    const diagnostic = describeProviderRequestFailure("OpenRouter", 402, JSON.stringify({ error: { message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }));
    expect(diagnostic).toContain("insufficient API credits");
    expect(diagnostic).toContain("Add credits");
    expect(diagnostic).not.toContain("metadata");
    expect(diagnostic).not.toContain("{");
  });

  it("includes only OpenRouter models whose billable usage dimensions are all zero", () => {
    expect(isVerifiedFreeOpenRouterModel({ id: "free-model", pricing: { prompt: "0", completion: "0", request: "0" } })).toBe(true);
    expect(isVerifiedFreeOpenRouterModel({ id: "paid-model", pricing: { prompt: "0", completion: "0.000001" } })).toBe(false);
    expect(isVerifiedFreeOpenRouterModel({ id: "unknown-price-model" })).toBe(false);
  });

  it("turns a transient fetch failure into a clear retryable provider diagnostic", () => {
    const diagnostic = describeProviderTransportFailure("OpenRouter", new TypeError("fetch failed"));
    expect(diagnostic).toContain("could not be reached");
    expect(diagnostic).toContain("No response was generated");
    expect(diagnostic).not.toContain("TypeError");
  });

  it("uses the native web search tool only when research mode is requested", () => {
    const standard = buildProviderCompletionPayload({ providerId: "openrouter", modelId: "openrouter/free", messages: [{ role: "user", content: "hello" }] });
    const research = buildProviderCompletionPayload({ providerId: "openrouter", modelId: "openrouter/free", messages: [{ role: "user", content: "latest news" }], research: true });
    expect(standard.max_completion_tokens).toBe(360);
    expect(standard).not.toHaveProperty("tools");
    expect(research).toMatchObject({ provider: { sort: "latency" }, tools: [{ type: "openrouter:web_search", parameters: { engine: "native", max_results: 3 } }] });
  });

  it("prioritizes known fast free-model families before an arbitrary catalog order", () => {
    const candidates = prioritizeFastFreeModels([
      { ...models[1], modelId: "cohere/slow-free", displayName: "Cohere" },
      { ...models[1], modelId: "google/fast-free", displayName: "Gemini" },
      { ...models[1], modelId: "qwen/fast-free", displayName: "Qwen" },
      { ...models[1], modelId: "openrouter/free", displayName: "Router" },
    ]);
    expect(candidates.map(model => model.modelId)).toEqual(["google/fast-free", "qwen/fast-free", "cohere/slow-free"]);
  });

  it("selects a real managed fallback from the live catalog even if preferred IDs change", () => {
    expect(selectManagedFastModels([{ id: "claude-haiku-4-5" }, { id: "other" }]).map(model => model.modelId)).toEqual(["claude-haiku-4-5"]);
    expect(selectManagedFastModels([{ id: "live-catalog-model" }]).map(model => model.modelId)).toEqual(["live-catalog-model"]);
  });
});
