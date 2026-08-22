import { describe, expect, it } from "vitest";
import { CallableModel, describeProviderRequestFailure, isVerifiedFreeOpenRouterModel, ProviderDiagnostic, retainCallableModels } from "./providerRegistry";

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
});
