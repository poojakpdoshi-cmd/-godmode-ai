import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({ ENV: { forgeApiKey: "safe-test-key", forgeApiUrl: "https://forge.test" } }));

const { invokeLLM } = await import("./_core/llm");

describe("managed LLM non-retryable quota handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not spend time retrying a non-retryable 412 quota failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 9, message: "usage exhausted" }), { status: 412, statusText: "Precondition Failed" })));
    await expect(invokeLLM({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hello" }] })).rejects.toThrow("412 Precondition Failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
