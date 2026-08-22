import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getConversationForUser: vi.fn(),
  updateConversationConfiguration: vi.fn(),
  appendConversationMessage: vi.fn(),
  updateConversationTitle: vi.fn(),
  listConversationMessages: vi.fn(),
  getConversationDetail: vi.fn(),
  getConversationMessageForUser: vi.fn(),
}));
const provider = vi.hoisted(() => ({ requireCallableModel: vi.fn(), invokeConfiguredModel: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./providerRegistry", () => provider);

import { buildProviderMessages, retryChatMessage, sendChatMessage } from "./chatService";

const conversation = { id: "conversation-1", userId: 7, title: "New conversation", systemPrompt: "Be concise and write TypeScript.", mode: "solo" as const, selectedModels: "[]" };

describe("chat execution service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.getConversationForUser.mockResolvedValue(conversation);
    db.appendConversationMessage.mockResolvedValueOnce({ id: "user-message-1" });
    db.listConversationMessages.mockResolvedValue([{ id: "user-message-1", role: "user", content: "Write a function", status: "completed" }]);
    db.getConversationDetail.mockResolvedValue({ conversation, messages: [] });
    provider.requireCallableModel.mockResolvedValue({});
  });

  it("prepends the system prompt and passes only completed conversation turns to a real provider request", () => {
    expect(buildProviderMessages("Act as a debugger", [
      { role: "user", content: "Hello", status: "completed" },
      { role: "assistant", content: "Provider failed", status: "failed" },
      { role: "assistant", content: "Hi", status: "completed" },
    ])).toEqual([
      { role: "system", content: "Act as a debugger" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  });

  it("persists the genuine model response with provider metadata", async () => {
    provider.invokeConfiguredModel.mockResolvedValue({ output: "function sum(a,b){ return a+b; }", usage: { totalTokens: 22 } });
    await sendChatMessage({ userId: 7, conversationId: conversation.id, content: "Write a function", mode: "solo", selections: [{ providerId: "openrouter", modelId: "qwen/test" }] });
    expect(provider.invokeConfiguredModel).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, providerId: "openrouter", modelId: "qwen/test", messages: [
      { role: "system", content: "Be concise and write TypeScript." },
      { role: "user", content: "Write a function" },
    ] }));
    expect(db.appendConversationMessage).toHaveBeenLastCalledWith(expect.objectContaining({ role: "assistant", status: "completed", providerId: "openrouter", modelId: "qwen/test", totalTokens: 22 }));
  });

  it("persists provider failures as retryable assistant records instead of inventing an answer", async () => {
    provider.invokeConfiguredModel.mockRejectedValue(new Error("Provider rejected request"));
    await sendChatMessage({ userId: 7, conversationId: conversation.id, content: "Write a function", mode: "solo", selections: [{ providerId: "openrouter", modelId: "qwen/test" }] });
    expect(db.appendConversationMessage).toHaveBeenLastCalledWith(expect.objectContaining({ role: "assistant", status: "failed", content: "", errorMessage: "Provider rejected request" }));
  });

  it("retries the failed model against its stored user-scoped thread", async () => {
    const failed = { id: "failed-response", conversationId: conversation.id, userId: 7, role: "assistant", status: "failed", providerId: "openrouter", modelId: "qwen/test", replyToMessageId: "user-message-1" };
    db.getConversationMessageForUser.mockResolvedValue(failed);
    db.listConversationMessages.mockResolvedValue([{ id: "user-message-1", role: "user", content: "Write a function", status: "completed" }, failed]);
    provider.invokeConfiguredModel.mockResolvedValue({ output: "Recovered answer", usage: { totalTokens: 31 } });
    await retryChatMessage({ userId: 7, messageId: failed.id });
    expect(provider.invokeConfiguredModel).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, providerId: "openrouter", modelId: "qwen/test" }));
    expect(db.appendConversationMessage).toHaveBeenLastCalledWith(expect.objectContaining({ role: "assistant", status: "completed", content: "Recovered answer", replyToMessageId: "user-message-1" }));
  });
});
