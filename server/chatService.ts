import * as db from "./db";
import { invokeConfiguredModel, ProviderId, requireCallableModel } from "./providerRegistry";

export type ChatSelection = { providerId: ProviderId; modelId: string };
export type ChatMode = "solo" | "competition";
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };

export function validateChatSelections(mode: ChatMode, selections: ChatSelection[]) {
  const unique = selections.filter((selection, index, list) => list.findIndex(candidate => candidate.providerId === selection.providerId && candidate.modelId === selection.modelId) === index);
  if (mode === "solo" && unique.length !== 1) throw new Error("Select exactly one callable model for a standard chat.");
  if (mode === "competition" && unique.length < 2) throw new Error("Select at least two callable models for chat comparison.");
  return unique;
}

export function buildProviderMessages(systemPrompt: string | null, messages: Array<{ role: string; content: string; status: string }>): ProviderMessage[] {
  return [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...messages.filter(message => message.status === "completed" && (message.role === "user" || message.role === "assistant")).map(message => ({ role: message.role as "user" | "assistant", content: message.content })),
  ];
}

function titleFromMessage(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 64) || "New conversation";
}

export async function sendChatMessage(input: { userId: number; conversationId: string; content: string; mode: ChatMode; selections: ChatSelection[] }) {
  const conversation = await db.getConversationForUser(input.userId, input.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  const selections = validateChatSelections(input.mode, input.selections);
  await Promise.all(selections.map(selection => requireCallableModel(input.userId, selection.providerId, selection.modelId)));
  await db.updateConversationConfiguration({ userId: input.userId, conversationId: conversation.id, mode: input.mode, selectedModels: JSON.stringify(selections) });
  const userMessage = await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, role: "user", content: input.content.trim() });
  if (conversation.title === "New conversation") await db.updateConversationTitle(input.userId, conversation.id, titleFromMessage(input.content));
  const history = await db.listConversationMessages(input.userId, conversation.id);
  const providerMessages = buildProviderMessages(conversation.systemPrompt, history);
  await Promise.all(selections.map(async selection => {
    const startedAt = Date.now();
    try {
      const result = await invokeConfiguredModel({ userId: input.userId, providerId: selection.providerId, modelId: selection.modelId, messages: providerMessages });
      await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: userMessage.id, role: "assistant", content: result.output || "The provider returned an empty response.", providerId: selection.providerId, modelId: selection.modelId, status: "completed", latencyMs: Date.now() - startedAt, ...result.usage });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_500) : "Unknown provider error";
      await db.appendConversationMessage({ userId: input.userId, conversationId: conversation.id, replyToMessageId: userMessage.id, role: "assistant", content: "", providerId: selection.providerId, modelId: selection.modelId, status: "failed", errorMessage: message, latencyMs: Date.now() - startedAt });
    }
  }));
  return db.getConversationDetail(input.userId, conversation.id);
}

export async function retryChatMessage(input: { userId: number; messageId: string }) {
  const failedMessage = await db.getConversationMessageForUser(input.userId, input.messageId);
  if (!failedMessage || failedMessage.role !== "assistant" || failedMessage.status !== "failed" || !failedMessage.providerId || !failedMessage.modelId) throw new Error("Only a failed model response can be retried.");
  const conversation = await db.getConversationForUser(input.userId, failedMessage.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  await requireCallableModel(input.userId, failedMessage.providerId as ProviderId, failedMessage.modelId);
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
