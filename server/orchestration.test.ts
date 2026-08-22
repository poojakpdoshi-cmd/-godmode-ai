import { describe, expect, it } from "vitest";
import { deriveMissionStatusFromLatestRuns, resolveMissionStatus, validateRunPlan } from "./orchestration";

describe("GODMODE orchestration planning", () => {
  const platform = { providerId: "platform" as const, modelId: "model-a" };
  const openRouter = { providerId: "openrouter" as const, modelId: "model-b" };

  it("allows exactly one real model in solo mode", () => {
    expect(validateRunPlan("solo", [platform])).toEqual([platform]);
  });

  it("rejects fabricated multi-model solo runs and under-specified competition", () => {
    expect(() => validateRunPlan("solo", [platform, openRouter])).toThrow("exactly one");
    expect(() => validateRunPlan("competition", [platform])).toThrow("at least two");
  });

  it("removes duplicate selections before competition execution", () => {
    expect(validateRunPlan("competition", [platform, platform, openRouter])).toEqual([platform, openRouter]);
  });

  it("marks outcomes from real request results without inventing a winner", () => {
    expect(resolveMissionStatus(2, 0)).toBe("completed");
    expect(resolveMissionStatus(1, 1)).toBe("partial");
    expect(resolveMissionStatus(0, 2)).toBe("failed");
  });

  it("uses the latest retry result for each model when resolving mission health", () => {
    expect(deriveMissionStatusFromLatestRuns([
      { providerId: "platform", modelId: "model-a", status: "succeeded" },
      { providerId: "platform", modelId: "model-a", status: "failed" },
      { providerId: "openrouter", modelId: "model-b", status: "failed" },
    ])).toBe("partial");
  });
});
