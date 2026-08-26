import { describe, expect, it } from "vitest";
import { defaultFastestSelection } from "../client/src/lib/modelRouting";

describe("default fastest selection", () => {
  it("chooses Claude Haiku over a separately available OpenRouter free route", () => {
    expect(defaultFastestSelection([
      { providerId: "openrouter", modelId: "openrouter/free" },
      { providerId: "platform", modelId: "gpt-5-mini" },
      { providerId: "platform", modelId: "claude-haiku-4-5" },
    ])).toEqual([{ providerId: "platform", modelId: "claude-haiku-4-5" }]);
  });

  it("retains the only available route when no managed fastest model is present", () => {
    expect(defaultFastestSelection([{ providerId: "openrouter", modelId: "openrouter/free" }])).toEqual([{ providerId: "openrouter", modelId: "openrouter/free" }]);
  });
});
