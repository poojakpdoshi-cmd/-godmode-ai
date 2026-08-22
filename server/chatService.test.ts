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

import { buildProviderMessages, compileExecutionPolicy, retryChatMessage, sendChatMessage } from "./chatService";

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
    ], false)).toEqual([
      { role: "system", content: "Act as a debugger" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  });

  it("bounds old conversation history while preserving the most recent completed turn", () => {
    const turns = Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn-${index}`, status: "completed" }));
    const providerMessages = buildProviderMessages(null, turns, false);
    expect(providerMessages).toHaveLength(12);
    expect(providerMessages[0]?.content).toBe("turn-4");
    expect(providerMessages.at(-1)?.content).toBe("turn-15");
  });

  it("adds the explicit fast-response policy after the saved orchestration prompt", () => {
    const providerMessages = buildProviderMessages("Use a friendly tone.", [{ role: "user", content: "Explain this", status: "completed" }]);
    expect(providerMessages[0]).toEqual({ role: "system", content: "Use a friendly tone." });
    expect(providerMessages[1]?.content).toContain("Fast response profile is active");
  });

  it("compiles an oversized saved prompt into a deterministic compact fast-execution policy", () => {
    const longPrompt = `${"A".repeat(5_000)}${"B".repeat(3_000)}`;
    const compiled = compileExecutionPolicy(longPrompt);
    expect(compiled).toContain("Fast execution policy");
    expect(compiled?.length).toBeLessThan(longPrompt.length);
    expect(compiled?.startsWith("A")).toBe(true);
    expect(compiled?.endsWith("B".repeat(1_000))).toBe(true);
  });

  it("persists the genuine model response with provider metadata", async () => {
    provider.invokeConfiguredModel.mockResolvedValue({ output: "function sum(a,b){ return a+b; }", usage: { totalTokens: 22 } });
    await sendChatMessage({ userId: 7, conversationId: conversation.id, content: "Write a function", mode: "solo", selections: [{ providerId: "openrouter", modelId: "qwen/test" }] });
    expect(provider.invokeConfiguredModel).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, providerId: "openrouter", modelId: "openrouter/free", messages: expect.arrayContaining([
      { role: "system", content: "Be concise and write TypeScript." },
      { role: "system", content: expect.stringContaining("Fast response profile is active") },
      { role: "user", content: "Write a function" },
    ]) }));
    expect(db.appendConversationMessage).toHaveBeenLastCalledWith(expect.objectContaining({ role: "assistant", status: "completed", providerId: "openrouter", modelId: "openrouter/free", totalTokens: 22 }));
  });

  it("applies the saved orchestration policy to every model in a comparison request", async () => {
    provider.invokeConfiguredModel.mockResolvedValue({ output: "Compared response", usage: { totalTokens: 12 } });
    await sendChatMessage({ userId: 7, conversationId: conversation.id, content: "Compare approaches", mode: "competition", selections: [{ providerId: "openrouter", modelId: "free-a" }, { providerId: "respan", modelId: "free-b" }] });
    expect(provider.invokeConfiguredModel).toHaveBeenCalledTimes(2);
    expect(provider.invokeConfiguredModel).toHaveBeenNthCalledWith(1, expect.objectContaining({ messages: expect.arrayContaining([{ role: "system", content: "Be concise and write TypeScript." }]) }));
    expect(provider.invokeConfiguredModel).toHaveBeenNthCalledWith(2, expect.objectContaining({ messages: expect.arrayContaining([{ role: "system", content: "Be concise and write TypeScript." }]) }));
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

  it("blocks a historical paid OpenRouter retry and directs the operator to a current free model", async () => {
    const failed = { id: "paid-response", conversationId: conversation.id, userId: 7, role: "assistant", status: "failed", providerId: "openrouter", modelId: "aion-labs/aion-2.0", replyToMessageId: "user-message-1" };
    db.getConversationMessageForUser.mockResolvedValue(failed);
    provider.requireCallableModel.mockRejectedValue(new Error("The selected model is not currently configured and callable."));
    await expect(retryChatMessage({ userId: 7, messageId: failed.id })).rejects.toThrow("paid or retired OpenRouter model");
    expect(provider.invokeConfiguredModel).not.toHaveBeenCalled();
  });
});
