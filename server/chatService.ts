import * as db from "./db";
import { invokeConfiguredModel, ProviderId, requireCallableModel } from "./providerRegistry";

export type ChatSelection = { providerId: ProviderId; modelId: string };
export type ChatMode = "solo" | "competition";
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHARACTERS = 24_000;
const FAST_RESPONSE_POLICY = "Fast response profile is active. Give the direct answer first, keep the answer under 160 words unless the user explicitly asks for depth, avoid restating the request, and use concise bullets only when they improve clarity.";
const FAST_POLICY_CHARACTER_LIMIT = 1_800;

export function validateChatSelections(mode: ChatMode, selections: ChatSelection[]) {
  const unique = selections.filter((selection, index, list) => list.findIndex(candidate => candidate.providerId === selection.providerId && candidate.modelId === selection.modelId) === index);
  if (mode === "solo" && unique.length !== 1) throw new Error("Select exactly one callable model for a standard chat.");
  if (mode === "competition" && unique.length < 2) throw new Error("Select at least two callable models for chat comparison.");
  return unique;
}

export function compileExecutionPolicy(systemPrompt: string | null, fast = true) {
  if (!systemPrompt || !fast || systemPrompt.length <= FAST_POLICY_CHARACTER_LIMIT) return systemPrompt;
  const opening = systemPrompt.slice(0, 1_300);
  const closing = systemPrompt.slice(-300);
  return `${opening}\n\n[Fast execution policy: the full saved prompt is retained, but this request uses the opening and closing instructions to minimize provider latency.]\n\n${closing}`;
}

export function buildProviderMessages(systemPrompt: string | null, messages: Array<{ role: string; content: string; status: string }>, fast = true): ProviderMessage[] {
  const activePolicy = compileExecutionPolicy(systemPrompt, fast);
  const completedTurns = messages.filter(message => message.status === "completed" && (message.role === "user" || message.role === "assistant")).slice(-MAX_HISTORY_TURNS);
  const recentTurns: ProviderMessage[] = [];
  let characters = 0;
  for (const message of [...completedTurns].reverse()) {
    if (recentTurns.length && characters + message.content.length > MAX_HISTORY_CHARACTERS) break;
    characters += message.content.length;
    recentTurns.unshift({ role: message.role as "user" | "assistant", content: message.content });
  }
  return [
    ...(activePolicy ? [{ role: "system" as const, content: activePolicy }] : []),
    ...(fast ? [{ role: "system" as const, content: FAST_RESPONSE_POLICY }] : []),
    ...recentTurns,
  ];
}

function titleFromMessage(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 64) || "New conversation";
}

export async function sendChatMessage(input: { userId: number; conversationId: string; content: string; mode: ChatMode; selections: ChatSelection[]; fast?: boolean; research?: boolean }) {
  const conversation = await db.getConversationForUser(input.userId, input.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  const selections = validateChatSelections(input.mode, input.selections);
  if (input.research && selections.some(selection => selection.providerId !== "openrouter")) throw new Error("Live web research currently requires OpenRouter routing. Select one or more OpenRouter models, then send again.");
  const routedSelections = input.fast !== false && input.mode === "solo" && selections[0]?.providerId === "openrouter" ? [{ providerId: "openrouter" as const, modelId: "openrouter/free" }] : selections;
  await Promise.all(routedSelections.map(selection => requireCallableModel(input.userId, selection.providerId, selection.modelId)));
  await db.updateConversationConfiguration({ userId: input.userId, conversationId: conversation.id, mode: input.mode, selectedModels: JSON.stringify(selections) });
  const userMessage = await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, role: "user", content: input.content.trim() });
  if (conversation.title === "New conversation") await db.updateConversationTitle(input.userId, conversation.id, titleFromMessage(input.content));
  const history = await db.listConversationMessages(input.userId, conversation.id);
  const providerMessages = buildProviderMessages(conversation.systemPrompt, history, input.fast !== false);
  await Promise.all(routedSelections.map(async selection => {
    const startedAt = Date.now();
    try {
      const result = await invokeConfiguredModel({ userId: input.userId, providerId: selection.providerId, modelId: selection.modelId, messages: providerMessages, research: input.research });
      await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: userMessage.id, role: "assistant", content: result.output || "The provider returned an empty response.", providerId: selection.providerId, modelId: selection.modelId, status: "completed", latencyMs: Date.now() - startedAt, ...result.usage });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_500) : "Unknown provider error";
      await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: userMessage.id, role: "assistant", content: "", providerId: selection.providerId, modelId: selection.modelId, status: "failed", errorMessage: message, latencyMs: Date.now() - startedAt });
    }
  }));
  return db.getConversationDetail(input.userId, conversation.id);
}

export async function prepareStreamedChat(input: { userId: number; conversationId: string; content: string; selection: ChatSelection }) {
  const conversation = await db.getConversationForUser(input.userId, input.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  if (input.selection.providerId !== "openrouter") throw new Error("Fast streaming currently requires OpenRouter routing.");
  const selection: ChatSelection = { providerId: "openrouter", modelId: "openrouter/free" };
  await requireCallableModel(input.userId, selection.providerId, selection.modelId);
  await db.updateConversationConfiguration({ userId: input.userId, conversationId: conversation.id, mode: "solo", selectedModels: JSON.stringify([input.selection]) });
  const userMessage = await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, role: "user", content: input.content.trim() });
  if (conversation.title === "New conversation") await db.updateConversationTitle(input.userId, conversation.id, titleFromMessage(input.content));
  const history = await db.listConversationMessages(input.userId, conversation.id);
  return { conversationId: conversation.id, userMessageId: userMessage.id, selection, messages: buildProviderMessages(conversation.systemPrompt, history, true) };
}

export async function persistStreamedAssistantMessage(input: { userId: number; conversationId: string; userMessageId: string; selection: ChatSelection; output: string; latencyMs: number; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }) {
  await db.appendConversationMessage({ userId: input.userId, conversationId: input.conversationId, replyToMessageId: input.userMessageId, role: "assistant", content: input.output || "The provider returned an empty response.", providerId: input.selection.providerId, modelId: input.selection.modelId, status: "completed", latencyMs: input.latencyMs, ...input.usage });
}

export async function persistStreamedFailure(input: { userId: number; conversationId: string; userMessageId: string; selection: ChatSelection; errorMessage: string; latencyMs: number }) {
  await db.appendConversationMessage({ userId: input.userId, conversationId: input.conversationId, replyToMessageId: input.userMessageId, role: "assistant", content: "", providerId: input.selection.providerId, modelId: input.selection.modelId, status: "failed", errorMessage: input.errorMessage.slice(0, 1_500), latencyMs: input.latencyMs });
}

export async function retryChatMessage(input: { userId: number; messageId: string }) {
  const failedMessage = await db.getConversationMessageForUser(input.userId, input.messageId);
  if (!failedMessage || failedMessage.role !== "assistant" || failedMessage.status !== "failed" || !failedMessage.providerId || !failedMessage.modelId) throw new Error("Only a failed model response can be retried.");
  const conversation = await db.getConversationForUser(input.userId, failedMessage.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  try {
    await requireCallableModel(input.userId, failedMessage.providerId as ProviderId, failedMessage.modelId);
  } catch {
    if (failedMessage.providerId === "openrouter") {
      throw new Error("This historical response used a paid or retired OpenRouter model. Choose a current free model from Model Routing and resend the prompt instead of retrying this model.");
    }
    throw new Error("This historical response uses a model that is no longer callable. Choose a current model and resend the prompt.");
  }
  const history = await db.listConversationMessages(input.userId, conversation.id);
  const failedIndex = history.findIndex(message => message.id === failedMessage.id);
  const providerMessages = buildProviderMessages(conversation.systemPrompt, history.slice(0, failedIndex));
  const startedAt = Date.now();
  try {
    const result = await invokeConfiguredModel({ userId: input.userId, providerId: failedMessage.providerId as ProviderId, modelId: failedMessage.modelId, messages: providerMessages });
    await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: failedMessage.replyToMessageId ?? undefined, role: "assistant", content: result.output || "The provider returned an empty response.", providerId: failedMessage.providerId, modelId: failedMessage.modelId, status: "completed", latencyMs: Date.now() - startedAt, ...result.usage });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_500) : "Unknown provider error";
    await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: failedMessage.replyToMessageId ?? undefined, role: "assistant", content: "", providerId: failedMessage.providerId, modelId: failedMessage.modelId, status: "failed", errorMessage: message, latencyMs: Date.now() - startedAt });
  }
  return db.getConversationDetail(input.userId, conversation.id);
}
