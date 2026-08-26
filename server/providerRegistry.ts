import * as db from "./db";
import { decryptProviderKey, encryptProviderKey } from "./providerSecrets";
import { invokeLLM, listLLMModels } from "./_core/llm";

export type ProviderId = "platform" | "openrouter" | "respan";
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export type CallableModel = { key: string; providerId: ProviderId; providerName: string; modelId: string; displayName: string; contextLength?: number; supportsTools: boolean; supportsVision: boolean; inputTypes: string[] };
export type ProviderDiagnostic = { providerId: ProviderId; providerName: string; configured: boolean; healthy: boolean; modelCount: number; checkedAt: number; error?: string; credentialStored?: boolean };
export type ModelRegistry = { models: CallableModel[]; diagnostics: ProviderDiagnostic[]; checkedAt: number };
type CompletionResult = { output: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
type CompatibleModel = { id: string; name?: string; context_length?: number; supported_parameters?: string[]; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; pricing?: Record<string, string | undefined> };

const PROVIDERS = {
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  respan: { name: "Respan", baseUrl: "https://api.respan.ai/api" },
} as const;
const cache = new Map<number, { expiresAt: number; registry: ModelRegistry }>();
const openRouterEligibilityCache = new Map<number, number>();
export const MODEL_REGISTRY_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 35_000;
const FAST_COMPLETION_TOKEN_LIMIT = 180;
const FAST_ROUTE_FIRST_TEXT_TIMEOUT_MS = 2_750;
const FAST_FREE_MODEL_IDS = ["cohere/north-mini-code:free", "nvidia/nemotron-3.5-lightning:free", "thinkingmachines/inkling-small:free"];
const DEPRIORITIZED_FAST_ROUTE_MODEL_IDS = ["liquid/lfm-2.5-2.6b:free"];
const FAST_FREE_MODEL_PREFIXES = ["cohere/", "nvidia/", "thinkingmachines/", "google/", "qwen/", "meta-llama/", "mistralai/"];
const MANAGED_FAST_MODEL_IDS = ["claude-haiku-4-5", "gpt-5-mini", "gpt-5-nano"];

function cleanBaseUrl(value: string) { return value.replace(/\/$/, ""); }
function textContent(content: unknown) { return typeof content === "string" ? content : Array.isArray(content) ? content.map(item => typeof item === "object" && item && "text" in item ? String(item.text ?? "") : "").filter(Boolean).join("\n") : ""; }
function safeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 500); }

export function selectManagedFastModels(catalog: Array<{ id: string }>): CallableModel[] {
  const preferred = MANAGED_FAST_MODEL_IDS.flatMap(modelId => catalog.filter(model => model.id === modelId));
  const selected = preferred.length ? preferred.slice(0, 2) : catalog.slice(0, 1);
  return selected.map(model => ({ key: `platform:${model.id}`, providerId: "platform", providerName: "GODMODE Managed Fast", modelId: model.id, displayName: model.id === "gpt-5-nano" ? "Managed Fast" : `Managed · ${model.id}`, supportsTools: false, supportsVision: false, inputTypes: ["text"] }));
}

async function discoverManagedFastModels(): Promise<CallableModel[]> {
  const catalog = await listLLMModels();
  return selectManagedFastModels(catalog.data);
}

async function verifyOpenRouterFreeAccess(apiKey: string) {
  const response = await fetch(`${PROVIDERS.openrouter.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-openrouter-title": "GODMODE AI" }, body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "user", content: "ping" }], max_tokens: 1, max_completion_tokens: 1 }) });
  if (!response.ok) throw new Error(describeProviderRequestFailure("OpenRouter", response.status, await response.text()));
  try { await response.body?.cancel(); } catch { /* Body is already settled. */ }
}

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

export function buildProviderCompletionPayload(input: { providerId: ProviderId; modelId: string; messages: ProviderMessage[]; research?: boolean }) {
  return {
    model: input.modelId,
    messages: input.messages,
    max_completion_tokens: FAST_COMPLETION_TOKEN_LIMIT,
    max_tokens: FAST_COMPLETION_TOKEN_LIMIT,
    ...(input.providerId === "openrouter" ? {
      provider: { sort: "latency", allow_fallbacks: true },
      ...(input.research ? { tools: [{ type: "openrouter:web_search", parameters: { engine: "native", max_results: 3, search_context_size: "low" } }] } : {}),
    } : {}),
  };
}

export function prioritizeFastFreeModels(models: CallableModel[]) {
  return [...models].filter(model => model.providerId === "openrouter" && model.modelId !== "openrouter/free").sort((left, right) => {
    const leftPreferred = FAST_FREE_MODEL_IDS.indexOf(left.modelId);
    const rightPreferred = FAST_FREE_MODEL_IDS.indexOf(right.modelId);
    const normalizedLeftPreferred = leftPreferred === -1 ? FAST_FREE_MODEL_IDS.length : leftPreferred;
    const normalizedRightPreferred = rightPreferred === -1 ? FAST_FREE_MODEL_IDS.length : rightPreferred;
    if (normalizedLeftPreferred !== normalizedRightPreferred) return normalizedLeftPreferred - normalizedRightPreferred;
    const leftDeprioritized = DEPRIORITIZED_FAST_ROUTE_MODEL_IDS.includes(left.modelId);
    const rightDeprioritized = DEPRIORITIZED_FAST_ROUTE_MODEL_IDS.includes(right.modelId);
    if (leftDeprioritized !== rightDeprioritized) return leftDeprioritized ? 1 : -1;
    const leftRank = FAST_FREE_MODEL_PREFIXES.findIndex(prefix => left.modelId.startsWith(prefix));
    const rightRank = FAST_FREE_MODEL_PREFIXES.findIndex(prefix => right.modelId.startsWith(prefix));
    const normalizedLeft = leftRank === -1 ? FAST_FREE_MODEL_PREFIXES.length : leftRank;
    const normalizedRight = rightRank === -1 ? FAST_FREE_MODEL_PREFIXES.length : rightRank;
    return normalizedLeft - normalizedRight || left.displayName.localeCompare(right.displayName);
  });
}

export function prioritizeDefaultFastestModels(models: CallableModel[]) {
  return [...models].sort((left, right) => {
    const leftManagedRank = left.providerId === "platform" ? MANAGED_FAST_MODEL_IDS.indexOf(left.modelId) : -1;
    const rightManagedRank = right.providerId === "platform" ? MANAGED_FAST_MODEL_IDS.indexOf(right.modelId) : -1;
    const normalizedLeftManagedRank = leftManagedRank === -1 ? MANAGED_FAST_MODEL_IDS.length : leftManagedRank;
    const normalizedRightManagedRank = rightManagedRank === -1 ? MANAGED_FAST_MODEL_IDS.length : rightManagedRank;
    if (normalizedLeftManagedRank !== normalizedRightManagedRank) return normalizedLeftManagedRank - normalizedRightManagedRank;
    if (left.modelId === "openrouter/free") return -1;
    if (right.modelId === "openrouter/free") return 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

export async function streamConfiguredModel(input: { userId: number; providerId: ProviderId; modelId: string; messages: ProviderMessage[] }, onChunk: (chunk: string) => void): Promise<CompletionResult> {
  await requireCallableModel(input.userId, input.providerId, input.modelId);
  if (input.providerId === "platform") throw new Error("Streaming is not available for the platform provider.");
  const configuration = await db.getProviderConfiguration(input.userId, input.providerId);
  if (!configuration?.credentialEncrypted || configuration.isEnabled !== "yes") throw new Error(`${PROVIDERS[input.providerId].name} is not connected for this user.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let receivedFirstToken = false;
  let firstTokenTimedOut = false;
  const firstTokenTimer = setTimeout(() => {
    if (!receivedFirstToken) {
      firstTokenTimedOut = true;
      controller.abort();
    }
  }, FAST_ROUTE_FIRST_TEXT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cleanBaseUrl(PROVIDERS[input.providerId].baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${decryptProviderKey(configuration.credentialEncrypted)}`, "content-type": "application/json", ...(input.providerId === "openrouter" ? { "x-openrouter-title": "GODMODE AI" } : {}) },
      body: JSON.stringify({ ...buildProviderCompletionPayload(input), stream: true, stream_options: { include_usage: true } }),
    });
  } catch (error) {
    clearTimeout(firstTokenTimer);
    if (firstTokenTimedOut) throw new Error(`${PROVIDERS[input.providerId].name} did not produce first text within ${FAST_ROUTE_FIRST_TEXT_TIMEOUT_MS / 1000}s. Trying another available free model.`);
    throw new Error(describeProviderTransportFailure(PROVIDERS[input.providerId].name, error));
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) { clearTimeout(firstTokenTimer); throw new Error(describeProviderRequestFailure(PROVIDERS[input.providerId].name, response.status, await response.text())); }
  if (!response.body) { clearTimeout(firstTokenTimer); throw new Error(`${PROVIDERS[input.providerId].name} opened an empty streaming response.`); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let usage: CompletionResult["usage"];
  try {
   while (true) {
    let read: ReadableStreamReadResult<Uint8Array>;
    try { read = await reader.read(); } catch (error) {
      if (firstTokenTimedOut) throw new Error(`${PROVIDERS[input.providerId].name} did not produce first text within ${FAST_ROUTE_FIRST_TEXT_TIMEOUT_MS / 1000}s. Trying another available free model.`);
      throw error;
    }
    const { value, done } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let divider = buffer.indexOf("\n\n");
    while (divider !== -1) {
      const event = buffer.slice(0, divider);
      buffer = buffer.slice(divider + 2);
      divider = buffer.indexOf("\n\n");
      const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
        const chunk = textContent(payload.choices?.[0]?.delta?.content);
        if (chunk) { receivedFirstToken = true; clearTimeout(firstTokenTimer); output += chunk; onChunk(chunk); }
        if (payload.usage) usage = { promptTokens: payload.usage.prompt_tokens, completionTokens: payload.usage.completion_tokens, totalTokens: payload.usage.total_tokens };
      } catch {
        // Ignore malformed non-content SSE frames from the upstream provider.
      }
    }
   }
  } finally { clearTimeout(firstTokenTimer); }
  return { output, usage };
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
  const relevantPrices = ["prompt", "completion", "request", "image", "audio", "video", "web_search", "internal_reasoning", "input_cache_read", "input_cache_write"];
  return relevantPrices.every(key => isZeroPrice(model.pricing?.[key]));
}

export function isTextChatCapableModel(model: CompatibleModel) {
  const inputModalities = model.architecture?.input_modalities;
  const outputModalities = model.architecture?.output_modalities;
  return (!inputModalities || inputModalities.includes("text")) && (!outputModalities || (outputModalities.includes("text") && outputModalities.every(modality => modality === "text")));
}

async function compatibleModels(providerId: "openrouter" | "respan", apiKey: string) {
  const provider = PROVIDERS[providerId];
  const response = await fetch(`${cleanBaseUrl(provider.baseUrl)}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`${provider.name} model discovery failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: CompatibleModel[] };
  if (!Array.isArray(body.data)) throw new Error(`${provider.name} returned an invalid model catalog`);
  const sourceModels = body.data.filter(model => Boolean(model.id));
  const permittedModels = providerId === "openrouter" ? sourceModels.filter(model => isVerifiedFreeOpenRouterModel(model) && isTextChatCapableModel(model)) : sourceModels.filter(isTextChatCapableModel);
  const discovered = permittedModels.map(model => ({ key: `${providerId}:${model.id}`, providerId, providerName: provider.name, modelId: model.id, displayName: model.name || model.id, contextLength: model.context_length, supportsTools: model.supported_parameters?.includes("tools") ?? false, supportsVision: model.architecture?.input_modalities?.includes("image") ?? false, inputTypes: model.architecture?.input_modalities ?? ["text"] })) as CallableModel[];
  if (providerId === "openrouter" && !discovered.some(model => model.modelId === "openrouter/free")) {
    discovered.unshift({ key: "openrouter:openrouter/free", providerId: "openrouter", providerName: "OpenRouter · Free router", modelId: "openrouter/free", displayName: "Free router (automatic)", supportsTools: false, supportsVision: false, inputTypes: ["text"] });
  }
  return discovered;
}

export async function getModelRegistry(userId: number, options: { force?: boolean; verifyOpenRouterAccess?: boolean } = {}): Promise<ModelRegistry> {
  const cached = cache.get(userId);
  const hasFreshOpenRouterEligibility = (openRouterEligibilityCache.get(userId) ?? 0) > Date.now();
  if (!options.force && cached && cached.expiresAt > Date.now() && (!options.verifyOpenRouterAccess || hasFreshOpenRouterEligibility)) return cached.registry;
  const checkedAt = Date.now();
  const models: CallableModel[] = [];
  const diagnostics: ProviderDiagnostic[] = [];
  try {
    const managed = await discoverManagedFastModels();
    if (managed.length) {
      models.push(...managed);
      diagnostics.push({ providerId: "platform", providerName: "GODMODE Managed Fast", configured: true, healthy: true, modelCount: managed.length, checkedAt, credentialStored: true });
    }
  } catch (error) {
    diagnostics.push({ providerId: "platform", providerName: "GODMODE Managed Fast", configured: false, healthy: false, modelCount: 0, checkedAt, error: safeError(error) });
  }
  const configurations = await db.listProviderConfigurations(userId);
  for (const providerId of ["openrouter", "respan"] as const) {
    const configuration = configurations.find(item => item.providerId === providerId && item.isEnabled === "yes" && item.credentialEncrypted);
    if (!configuration?.credentialEncrypted) {
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: false, healthy: false, modelCount: 0, checkedAt, credentialStored: false, error: `No ${PROVIDERS[providerId].name} key is connected for this user.` });
      continue;
    }
    try {
      if (providerId === "openrouter" && options.verifyOpenRouterAccess && (options.force || !hasFreshOpenRouterEligibility)) {
        await verifyOpenRouterFreeAccess(decryptProviderKey(configuration.credentialEncrypted));
        openRouterEligibilityCache.set(userId, Date.now() + 10 * 60_000);
      }
      const discovered = await compatibleModels(providerId, decryptProviderKey(configuration.credentialEncrypted));
      models.push(...discovered);
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: true, healthy: true, modelCount: discovered.length, checkedAt, credentialStored: true });
    } catch (error) {
      diagnostics.push({ providerId, providerName: PROVIDERS[providerId].name, configured: true, healthy: false, modelCount: 0, checkedAt, credentialStored: true, error: safeError(error) });
    }
  }
  const registry = {
    models: prioritizeDefaultFastestModels(retainCallableModels(models, diagnostics)),
    diagnostics,
    checkedAt,
  };
  cache.set(userId, { registry, expiresAt: Date.now() + MODEL_REGISTRY_TTL_MS });
  return registry;
}

export async function assertOpenRouterFreeAccess(userId: number) {
  const registry = await getModelRegistry(userId, { verifyOpenRouterAccess: true });
  const diagnostic = registry.diagnostics.find(item => item.providerId === "openrouter");
  if (!diagnostic?.healthy) {
    throw new Error(diagnostic?.error || "OpenRouter free access is not verified for this account. Verify the API key credit limit and account balance, then refresh live access.");
  }
  return registry;
}

export async function getFastFreeCandidates(userId: number) {
  return prioritizeFastFreeModels((await assertOpenRouterFreeAccess(userId)).models).slice(0, 1);
}

export async function getRespanFallbackModel(userId: number) {
  const model = (await getModelRegistry(userId)).models.find(candidate => candidate.providerId === "respan");
  if (!model) throw new Error("No connected Respan fallback model is available for this user.");
  return model;
}

export function shouldUseRespanFallback(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ["rate-limiting", "insufficient api credits", "not authorized", "free access is not verified", "did not produce first text", "did not start producing text", "all available free models"].some(trigger => message.includes(trigger));
}

export function clearModelRegistryCache(userId?: number) {
  if (userId === undefined) { cache.clear(); openRouterEligibilityCache.clear(); }
  else { cache.delete(userId); openRouterEligibilityCache.delete(userId); }
}

export async function connectProvider(userId: number, providerId: "openrouter" | "respan", apiKey: string) {
  if (providerId === "openrouter") await verifyOpenRouterFreeAccess(apiKey.trim());
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

export async function invokeConfiguredModel(input: { userId: number; providerId: ProviderId; modelId: string; messages: ProviderMessage[]; research?: boolean }): Promise<CompletionResult> {
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
      body: JSON.stringify(buildProviderCompletionPayload(input)),
    });
  } catch (error) {
    throw new Error(describeProviderTransportFailure(PROVIDERS[input.providerId].name, error));
  } finally {
    clearTimeout(timeout);
  }
  const bodyText = await response.text();
  if (!response.ok) throw new Error(describeProviderRequestFailure(PROVIDERS[input.providerId].name, response.status, bodyText));
  const body = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: unknown; annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const content = textContent(body.choices?.[0]?.message?.content);
  const citations = (body.choices?.[0]?.message?.annotations ?? []).filter(annotation => annotation.type === "url_citation" && annotation.url_citation?.url).map(annotation => annotation.url_citation!);
  const sourceAppendix = citations.length ? `\n\nSources:\n${citations.map((citation, index) => `- [${citation.title || `Source ${index + 1}`}](${citation.url})`).join("\n")}` : "";
  return { output: `${content}${sourceAppendix}`, usage: body.usage ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens } : undefined };
}
