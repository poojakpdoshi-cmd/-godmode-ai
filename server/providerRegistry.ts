import * as db from "./db";
import { decryptProviderKey, encryptProviderKey } from "./providerSecrets";
import { invokeLLM } from "./_core/llm";

export type ProviderId = "platform" | "openrouter" | "respan";
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export type CallableModel = { key: string; providerId: ProviderId; providerName: string; modelId: string; displayName: string; contextLength?: number; supportsTools: boolean; supportsVision: boolean; inputTypes: string[] };
export type ProviderDiagnostic = { providerId: ProviderId; providerName: string; configured: boolean; healthy: boolean; modelCount: number; checkedAt: number; error?: string; credentialStored?: boolean };
export type ModelRegistry = { models: CallableModel[]; diagnostics: ProviderDiagnostic[]; checkedAt: number };
type CompletionResult = { output: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
type CompatibleModel = { id: string; name?: string; context_length?: number; supported_parameters?: string[]; architecture?: { input_modalities?: string[] }; pricing?: Record<string, string | undefined> };

const PROVIDERS = {
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  respan: { name: "Respan", baseUrl: "https://api.respan.ai/api" },
} as const;
const cache = new Map<number, { expiresAt: number; registry: ModelRegistry }>();
const REQUEST_TIMEOUT_MS = 35_000;
const FAST_COMPLETION_TOKEN_LIMIT = 360;

function cleanBaseUrl(value: string) { return value.replace(/\/$/, ""); }
function textContent(content: unknown) { return typeof content === "string" ? content : Array.isArray(content) ? content.map(item => typeof item === "object" && item && "text" in item ? String(item.text ?? "") : "").filter(Boolean).join("\n") : ""; }
function safeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 500); }

export function describeProviderRequestFailure(providerName: string, status: number, bodyText: string) {
  let upstreamMessage = "";
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } | unknown; message?: unknown };
    const nested = parsed.error && typeof parsed.error === "object" && "message" in parsed.error ? parsed.error.message : undefined;
    upstreamMessage = typeof nested === "string" ? nested : typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    upstreamMessage = bodyText;
  }
  if (status === 402) return `${providerName} could not run this model because the connected account has insufficient API credits. Add credits or choose a model available to that account, then retry this exact model.`;
  if (status === 401 || status === 403) return `${providerName} rejected this request because the connected API key is not authorized for the selected model. Reconnect the correct key or choose an allowed model.`;
  if (status === 429) return `${providerName} is rate-limiting this account. Wait briefly, then retry this exact model.`;
  const detail = upstreamMessage.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 280);
  return detail ? `${providerName} request failed (HTTP ${status}): ${detail}` : `${providerName} request failed with HTTP ${status}.`;
}

export function describeProviderTransportFailure(providerName: string, error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return `${providerName} did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds. The request was stopped safely; retry the same model once the provider is available.`;
  const detail = safeError(error).replace(/^TypeError:\s*/i, "");
  return `${providerName} could not be reached for this request. No response was generated. Check the connection and retry the same model.${detail && detail !== "fetch failed" ? ` Detail: ${detail}` : ""}`;
}

export function retainCallableModels(models: CallableModel[], diagnostics: ProviderDiagnostic[]) {
  const healthy = new Set(diagnostics.filter(diagnostic => diagnostic.configured && diagnostic.healthy).map(diagnostic => diagnostic.providerId));
  return models.filter(model => healthy.has(model.providerId));
}

function isZeroPrice(value: string | undefined) {
  if (value === undefined) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

export function isVerifiedFreeOpenRouterModel(model: CompatibleModel) {
  if (!model.pricing) return false;
  const relevantPrices = ["prompt", "completion", "request", "image", "web_search", "internal_reasoning", "input_cache_read", "input_cache_write"];
  return relevantPrices.every(key => isZeroPrice(model.pricing?.[key]));
}

async function compatibleModels(providerId: "openrouter" | "respan", apiKey: string) {
  const provider = PROVIDERS[providerId];
  const response = await fetch(`${cleanBaseUrl(provider.baseUrl)}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`${provider.name} model discovery failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: CompatibleModel[] };
  if (!Array.isArray(body.data)) throw new Error(`${provider.name} returned an invalid model catalog`);
  const sourceModels = body.data.filter(model => Boolean(model.id));
  const permittedModels = providerId === "openrouter" ? sourceModels.filter(isVerifiedFreeOpenRouterModel) : sourceModels;
  const discovered = permittedModels.map(model => ({ key: `${providerId}:${model.id}`, providerId, providerName: provider.name, modelId: model.id, displayName: model.name || model.id, contextLength: model.context_length, supportsTools: model.supported_parameters?.includes("tools") ?? false, supportsVision: model.architecture?.input_modalities?.includes("image") ?? false, inputTypes: model.architecture?.input_modalities ?? ["text"] })) as CallableModel[];
  if (providerId === "openrouter" && !discovered.some(model => model.modelId === "openrouter/free")) {
    discovered.unshift({ key: "openrouter:openrouter/free", providerId: "openrouter", providerName: "OpenRouter · Free router", modelId: "openrouter/free", displayName: "Free router (automatic)", supportsTools: false, supportsVision: false, inputTypes: ["text"] });
  }
  return discovered;
}

export async function getModelRegistry(userId: number, options: { force?: boolean } = {}): Promise<ModelRegistry> {
  const cached = cache.get(userId);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.registry;
  const checkedAt = Date.now();
  const models: CallableModel[] = [];
  const diagnostics: ProviderDiagnostic[] = [];
  const configurations = await db.listProviderConfigurations(userId);
  for (const providerId of ["openrouter", "respan"] as const) {
    const configuration = configurations.find(item => item.providerId === providerId && item.isEnabled === "yes" && item.credentialEncrypted);
    if (!configuration?.credentialEncrypted) {
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: false, healthy: false, modelCount: 0, checkedAt, credentialStored: false, error: `No ${PROVIDERS[providerId].name} key is connected for this user.` });
      continue;
    }
    try {
      const discovered = await compatibleModels(providerId, decryptProviderKey(configuration.credentialEncrypted));
      models.push(...discovered);
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: true, healthy: true, modelCount: discovered.length, checkedAt, credentialStored: true });
    } catch (error) {
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: true, healthy: false, modelCount: 0, checkedAt, credentialStored: true, error: safeError(error) });
    }
  }
  const registry = {
    models: retainCallableModels(models, diagnostics).sort((a, b) => {
      if (a.modelId === "openrouter/free") return -1;
      if (b.modelId === "openrouter/free") return 1;
      return a.displayName.localeCompare(b.displayName);
    }),
    diagnostics,
    checkedAt,
  };
  cache.set(userId, { registry, expiresAt: Date.now() + 30_000 });
  return registry;
}

export function clearModelRegistryCache(userId?: number) { if (userId === undefined) cache.clear(); else cache.delete(userId); }

export async function connectProvider(userId: number, providerId: "openrouter" | "respan", apiKey: string) {
  const discovered = await compatibleModels(providerId, apiKey.trim());
  if (!discovered.length) throw new Error(`${PROVIDERS[providerId].name} did not expose any callable models for this key.`);
  await db.upsertProviderConfiguration({ userId, providerId, displayName: PROVIDERS[providerId].name, credentialEncrypted: encryptProviderKey(apiKey) });
  clearModelRegistryCache(userId);
  return getModelRegistry(userId, { force: true });
}

export async function disconnectProvider(userId: number, providerId: "openrouter" | "respan") {
  await db.disableProviderConfiguration(userId, providerId);
  clearModelRegistryCache(userId);
  return getModelRegistry(userId, { force: true });
}

export async function requireCallableModel(userId: number, providerId: ProviderId, modelId: string) {
  const model = (await getModelRegistry(userId)).models.find(candidate => candidate.providerId === providerId && candidate.modelId === modelId);
  if (!model) throw new Error("The selected model is not currently configured and callable.");
  return model;
}

export async function invokeConfiguredModel(input: { userId: number; providerId: ProviderId; modelId: string; messages: ProviderMessage[] }): Promise<CompletionResult> {
  await requireCallableModel(input.userId, input.providerId, input.modelId);
  if (input.providerId === "platform") {
    const result = await invokeLLM({ model: input.modelId, messages: input.messages });
    return { output: textContent(result.choices[0]?.message.content), usage: result.usage ? { promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens, totalTokens: result.usage.total_tokens } : undefined };
  }
  const configuration = await db.getProviderConfiguration(input.userId, input.providerId);
  if (!configuration?.credentialEncrypted || configuration.isEnabled !== "yes") throw new Error(`${PROVIDERS[input.providerId].name} is not connected for this user.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cleanBaseUrl(PROVIDERS[input.providerId].baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${decryptProviderKey(configuration.credentialEncrypted)}`, "content-type": "application/json", ...(input.providerId === "openrouter" ? { "x-openrouter-title": "GODMODE AI" } : {}) },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        max_completion_tokens: FAST_COMPLETION_TOKEN_LIMIT,
        max_tokens: FAST_COMPLETION_TOKEN_LIMIT,
        ...(input.providerId === "openrouter" ? { provider: { sort: "latency", allow_fallbacks: true } } : {}),
      }),
    });
  } catch (error) {
    throw new Error(describeProviderTransportFailure(PROVIDERS[input.providerId].name, error));
  } finally {
    clearTimeout(timeout);
  }
  const bodyText = await response.text();
  if (!response.ok) throw new Error(describeProviderRequestFailure(PROVIDERS[input.providerId].name, response.status, bodyText));
  const body = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  return { output: textContent(body.choices?.[0]?.message?.content), usage: body.usage ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens } : undefined };
}
