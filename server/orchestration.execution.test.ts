import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getMissionForUser: vi.fn(),
  updateMissionStatus: vi.fn(),
  createExecutionEvent: vi.fn(),
  createRun: vi.fn(),
  updateRunStarted: vi.fn(),
  updateRunSucceeded: vi.fn(),
  updateRunFailed: vi.fn(),
  getMissionDetail: vi.fn(),
  getRunForUser: vi.fn(),
}));

const provider = vi.hoisted(() => ({
  requireCallableModel: vi.fn(),
  invokeConfiguredModel: vi.fn(),
}));

vi.mock("./db", () => db);
vi.mock("./providerRegistry", () => provider);

import { executeMission, retryRun } from "./orchestration";

const mission = {
  id: "mission-1",
  userId: 41,
  projectId: "project-1",
  title: "Mission",
  command: "Produce a verified result.",
  systemPrompt: null,
  mode: "solo" as const,
  status: "draft" as const,
};

describe("execution outcome persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.getMissionForUser.mockResolvedValue(mission);
    db.createRun.mockResolvedValue({ id: "run-1" });
    db.getMissionDetail.mockResolvedValue({ mission, runs: [], events: [], messages: [] });
    provider.requireCallableModel.mockResolvedValue({});
  });

  it("persists a provider failure, including the error event, before settling the mission", async () => {
    provider.invokeConfiguredModel.mockRejectedValue(new Error("Provider rejected the request"));

    await executeMission({
      userId: 41,
      missionId: mission.id,
      selections: [{ providerId: "platform", modelId: "model-a" }],
    });

    expect(db.updateRunFailed).toHaveBeenCalledWith(41, "run-1", "Provider rejected the request", expect.any(Number));
    expect(db.createExecutionEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "REQUEST_FAILED", level: "error", runId: "run-1" }));
    expect(db.updateMissionStatus).toHaveBeenLastCalledWith(41, mission.id, "failed");
  });

  it("retries the original model and settles from the newest genuine retry outcome", async () => {
    db.getRunForUser.mockResolvedValue({ id: "prior-run", missionId: mission.id, providerId: "platform", modelId: "model-a" });
    db.createRun.mockResolvedValue({ id: "retry-run" });
    provider.invokeConfiguredModel.mockResolvedValue({ output: "Recovered output", usage: { totalTokens: 34 } });
    db.getMissionDetail.mockResolvedValue({
      mission,
      runs: [{ providerId: "platform", modelId: "model-a", status: "succeeded" }],
      events: [],
      messages: [],
    });

    await retryRun({ userId: 41, runId: "prior-run" });

    expect(db.createExecutionEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "RETRY_REQUESTED", runId: "prior-run" }));
    expect(db.updateRunSucceeded).toHaveBeenCalledWith(41, "retry-run", expect.objectContaining({ output: "Recovered output", totalTokens: 34 }));
    expect(db.updateMissionStatus).toHaveBeenLastCalledWith(41, mission.id, "completed");
  });
});
