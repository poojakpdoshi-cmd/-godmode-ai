import { describe, expect, it } from "vitest";
import { buildProviderCompletionPayload, CallableModel, describeProviderRequestFailure, describeProviderTransportFailure, isTextChatCapableModel, isVerifiedFreeOpenRouterModel, MODEL_REGISTRY_TTL_MS, prioritizeDefaultFastestModels, prioritizeFastFreeModels, ProviderDiagnostic, retainCallableModels, selectManagedFastModels } from "./providerRegistry";

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

  it("keeps the chat registry text-only and excludes explicit audio-output models", () => {
    expect(isTextChatCapableModel({ id: "text-chat", architecture: { input_modalities: ["text"], output_modalities: ["text"] } })).toBe(true);
    expect(isTextChatCapableModel({ id: "audio-generation", architecture: { input_modalities: ["text"], output_modalities: ["audio"] } })).toBe(false);
    expect(isTextChatCapableModel({ id: "mixed-audio-generation", architecture: { input_modalities: ["text"], output_modalities: ["text", "audio"] } })).toBe(false);
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
    expect(standard.max_completion_tokens).toBe(180);
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
    expect(candidates.map(model => model.modelId)).toEqual(["cohere/slow-free", "google/fast-free", "qwen/fast-free"]);
  });

  it("puts the measured fast Cohere candidate ahead of a known slow fast-route candidate", () => {
    const candidates = prioritizeFastFreeModels([
      { ...models[1], modelId: "liquid/lfm-2.5-2.6b:free", displayName: "Liquid" },
      { ...models[1], modelId: "cohere/north-mini-code:free", displayName: "Cohere North" },
    ]);
    expect(candidates.map(model => model.modelId)).toEqual(["cohere/north-mini-code:free", "liquid/lfm-2.5-2.6b:free"]);
  });

  it("makes the measured managed route the default fastest choice while preserving the free route separately", () => {
    const ranked = prioritizeDefaultFastestModels([
      { ...models[1], modelId: "openrouter/free", displayName: "Free router" },
      { ...models[0], modelId: "gpt-5-mini", displayName: "GPT mini" },
      { ...models[0], modelId: "claude-haiku-4-5", displayName: "Claude Haiku" },
    ]);
    expect(ranked.map(model => model.modelId)).toEqual(["claude-haiku-4-5", "gpt-5-mini", "openrouter/free"]);
  });

  it("selects a real managed fallback from the live catalog even if preferred IDs change", () => {
    expect(selectManagedFastModels([{ id: "claude-haiku-4-5" }, { id: "other" }]).map(model => model.modelId)).toEqual(["claude-haiku-4-5"]);
    expect(selectManagedFastModels([{ id: "gpt-5-mini" }, { id: "claude-haiku-4-5" }]).map(model => model.modelId)).toEqual(["claude-haiku-4-5", "gpt-5-mini"]);
    expect(selectManagedFastModels([{ id: "live-catalog-model" }]).map(model => model.modelId)).toEqual(["live-catalog-model"]);
  });

  it("keeps the verified model registry warm long enough to remove catalog discovery from repeated chat sends", () => {
    expect(MODEL_REGISTRY_TTL_MS).toBe(10 * 60_000);
  });
});
