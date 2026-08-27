import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatBubble } from "../client/src/components/GodmodeChatWorkspace";

describe("Managed Fast quota failure rendering", () => {
  it("renders the safe recovery diagnostic and never the raw 412 upstream payload", () => {
    const recovery = "GODMODE Managed Fast is temporarily unavailable because this project’s managed usage allowance is exhausted. Your OpenRouter, NVIDIA NIM, and Respan keys were not used. Open Configuration, connect or select one of your provider models, then resend the message.";
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: { id: "managed-412", role: "assistant", content: "", providerId: "platform", modelId: "claude-haiku-4-5", researchMode: "no", status: "failed", errorMessage: recovery, firstTokenMs: null, latencyMs: 12, totalTokens: null, createdAt: new Date() },
      attachments: [], onRetry: () => undefined, onChooseFree: () => undefined, canRetry: false, retrying: false,
    }));
    expect(html).toContain("managed usage allowance is exhausted");
    expect(html).toContain("Open Configuration");
    expect(html).not.toContain("Precondition Failed");
    expect(html).not.toContain('"code":9');
  });
});
