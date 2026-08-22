import { invokeLLM, listLLMModels } from "./_core/llm";

export type ProviderId = "platform" | "openrouter";

export type CallableModel = {
  key: string;
  providerId: ProviderId;
  providerName: string;
  modelId: string;
  displayName: string;
  contextLength?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  inputTypes: string[];
};

export type ProviderDiagnostic = {
  providerId: ProviderId;
  providerName: string;
  configured: boolean;
  healthy: boolean;
  modelCount: number;
  checkedAt: number;
  error?: string;
};

export type ModelRegistry = {
  models: CallableModel[];
  diagnostics: ProviderDiagnostic[];
  checkedAt: number;
};

export function retainCallableModels(models: CallableModel[], diagnostics: ProviderDiagnostic[]): CallableModel[] {
  const healthyProviders = new Set(
    diagnostics.filter(diagnostic => diagnostic.configured && diagnostic.healthy).map(diagnostic => diagnostic.providerId)
  );
  return models.filter(model => healthyProviders.has(model.providerId));
}

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
  };
};

type CompletionResult = {
  output: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_CACHE_MS = 30_000;
let cachedRegistry: { expiresAt: number; registry: ModelRegistry } | undefined;

function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(item => (typeof item === "object" && item && "text" in item ? String(item.text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 500);
}

async function fetchOpenRouterModels(apiKey: string): Promise<CallableModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter model discovery failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: OpenRouterModel[] };
  if (!Array.isArray(body.data)) throw new Error("OpenRouter returned an invalid model catalog");
  return body.data
    .filter(model => Boolean(model.id))
    .map(model => ({
      key: `openrouter:${model.id}`,
      providerId: "openrouter" as const,
      providerName: "OpenRouter",
      modelId: model.id,
      displayName: model.name || model.id,
      contextLength: model.context_length,
      supportsTools: model.supported_parameters?.includes("tools") ?? false,
      supportsVision: model.architecture?.input_modalities?.includes("image") ?? false,
      inputTypes: model.architecture?.input_modalities ?? ["text"],
    }));
}

export async function getModelRegistry(options: { force?: boolean } = {}): Promise<ModelRegistry> {
  if (!options.force && cachedRegistry && cachedRegistry.expiresAt > Date.now()) {
    return cachedRegistry.registry;
  }

  const checkedAt = Date.now();
  const models: CallableModel[] = [];
  const diagnostics: ProviderDiagnostic[] = [];
  const platformConfigured = Boolean(process.env.BUILT_IN_FORGE_API_KEY);

  if (platformConfigured) {
    try {
      const catalog = await listLLMModels();
      const platformModels = catalog.data
        .filter(model => Boolean(model.id))
        .map(model => ({
          key: `platform:${model.id}`,
          providerId: "platform" as const,
          providerName: "Platform catalog",
          modelId: model.id,
          displayName: model.id,
          supportsTools: false,
          supportsVision: false,
          inputTypes: ["text"],
        }));
      models.push(...platformModels);
      diagnostics.push({
        providerId: "platform",
        providerName: "Platform catalog",
        configured: true,
        healthy: true,
        modelCount: platformModels.length,
        checkedAt,
      });
    } catch (error) {
      diagnostics.push({
        providerId: "platform",
        providerName: "Platform catalog",
        configured: true,
        healthy: false,
        modelCount: 0,
        checkedAt,
        error: normalizedError(error),
      });
    }
  } else {
    diagnostics.push({
      providerId: "platform",
      providerName: "Platform catalog",
      configured: false,
      healthy: false,
      modelCount: 0,
      checkedAt,
      error: "The platform provider is not configured in this runtime.",
    });
  }

  const openRouterKey = getOpenRouterKey();
  if (openRouterKey) {
    try {
      const openRouterModels = await fetchOpenRouterModels(openRouterKey);
      models.push(...openRouterModels);
      diagnostics.push({
        providerId: "openrouter",
        providerName: "OpenRouter",
        configured: true,
        healthy: true,
        modelCount: openRouterModels.length,
        checkedAt,
      });
    } catch (error) {
      diagnostics.push({
        providerId: "openrouter",
        providerName: "OpenRouter",
        configured: true,
        healthy: false,
        modelCount: 0,
        checkedAt,
        error: normalizedError(error),
      });
    }
  } else {
    diagnostics.push({
      providerId: "openrouter",
      providerName: "OpenRouter",
      configured: false,
      healthy: false,
      modelCount: 0,
      checkedAt,
      error: "No server-side OpenRouter credential is configured.",
    });
  }

  const registry = { models: retainCallableModels(models, diagnostics).sort((a, b) => a.displayName.localeCompare(b.displayName)), diagnostics, checkedAt };
  cachedRegistry = { registry, expiresAt: Date.now() + MODEL_CACHE_MS };
  return registry;
}

export function clearModelRegistryCache() {
  cachedRegistry = undefined;
}

export async function requireCallableModel(providerId: ProviderId, modelId: string): Promise<CallableModel> {
  const registry = await getModelRegistry();
  const model = registry.models.find(candidate => candidate.providerId === providerId && candidate.modelId === modelId);
  if (!model) {
    throw new Error("The selected model is not currently configured and callable.");
  }
  return model;
}

export async function invokeConfiguredModel(input: {
  providerId: ProviderId;
  modelId: string;
  command: string;
  systemPrompt?: string | null;
}): Promise<CompletionResult> {
  await requireCallableModel(input.providerId, input.modelId);
  const messages = [
    ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
    { role: "user" as const, content: input.command },
  ];

  if (input.providerId === "platform") {
    const result = await invokeLLM({ model: input.modelId, messages });
    return {
      output: contentToText(result.choices[0]?.message.content),
      usage: result.usage
        ? {
            promptTokens: result.usage.prompt_tokens,
            completionTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          }
        : undefined,
    };
  }

  const apiKey = getOpenRouterKey();
  if (!apiKey) throw new Error("OpenRouter is not configured in this runtime.");
  const response = await fetch(OPENROUTER_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-openrouter-title": "GODMODE AI",
    },
    body: JSON.stringify({ model: input.modelId, messages }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }
  const body = JSON.parse(bodyText) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    output: contentToText(body.choices?.[0]?.message?.content),
    usage: body.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        }
      : undefined,
  };
}
