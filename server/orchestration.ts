import * as db from "./db";
import { invokeConfiguredModel, ProviderId, requireCallableModel } from "./providerRegistry";

export type SelectedModel = { providerId: ProviderId; modelId: string };
export type MissionMode = "solo" | "competition";

export function validateRunPlan(mode: MissionMode, selections: SelectedModel[]): SelectedModel[] {
  const unique = selections.filter((selection, index, array) => array.findIndex(candidate => candidate.providerId === selection.providerId && candidate.modelId === selection.modelId) === index);
  if (mode === "solo" && unique.length !== 1) throw new Error("Solo mode requires exactly one configured model.");
  if (mode === "competition" && unique.length < 2) throw new Error("Competition mode requires at least two distinct configured models.");
  return unique;
}

export function resolveMissionStatus(successCount: number, failureCount: number): "completed" | "partial" | "failed" {
  if (successCount === 0) return "failed";
  if (failureCount > 0) return "partial";
  return "completed";
}

export function deriveMissionStatusFromLatestRuns(runs: Array<{ providerId: string; modelId: string; status: string }>): "completed" | "partial" | "failed" {
  const latestByModel = new Map<string, string>();
  runs.forEach(run => {
    const key = `${run.providerId}:${run.modelId}`;
    if (!latestByModel.has(key)) latestByModel.set(key, run.status);
  });
  const latestStatuses = Array.from(latestByModel.values());
  return resolveMissionStatus(latestStatuses.filter(value => value === "succeeded").length, latestStatuses.filter(value => value === "failed").length);
}

async function executeRun(input: { userId: number; missionId: string; projectId: string; mode: MissionMode; selection: SelectedModel; command: string; systemPrompt?: string | null }) {
  await requireCallableModel(input.selection.providerId, input.selection.modelId);
  const run = await db.createRun({ userId: input.userId, missionId: input.missionId, projectId: input.projectId, providerId: input.selection.providerId, modelId: input.selection.modelId, mode: input.mode });
  await db.createExecutionEvent({ userId: input.userId, missionId: input.missionId, runId: run.id, type: "RUN_QUEUED", level: "info", summary: `${input.selection.modelId} is queued.`, metadata: { providerId: input.selection.providerId, modelId: input.selection.modelId } });
  await db.updateRunStarted(input.userId, run.id);
  await db.createExecutionEvent({ userId: input.userId, missionId: input.missionId, runId: run.id, type: "REQUEST_STARTED", level: "info", summary: `${input.selection.modelId} request started.` });
  const startedAt = Date.now();
  try {
    const result = await invokeConfiguredModel({ providerId: input.selection.providerId, modelId: input.selection.modelId, command: input.command, systemPrompt: input.systemPrompt });
    const latencyMs = Date.now() - startedAt;
    await db.updateRunSucceeded(input.userId, run.id, { output: result.output, latencyMs, ...result.usage });
    await db.createExecutionEvent({ userId: input.userId, missionId: input.missionId, runId: run.id, type: "REQUEST_SUCCEEDED", level: "success", summary: `${input.selection.modelId} returned a result.`, metadata: { latencyMs, usage: result.usage } });
    return { runId: run.id, status: "succeeded" as const };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message.slice(0, 1500) : "Unknown provider failure";
    await db.updateRunFailed(input.userId, run.id, message, latencyMs);
    await db.createExecutionEvent({ userId: input.userId, missionId: input.missionId, runId: run.id, type: "REQUEST_FAILED", level: "error", summary: `${input.selection.modelId} failed.`, detail: message, metadata: { latencyMs } });
    return { runId: run.id, status: "failed" as const };
  }
}

export async function executeMission(input: { userId: number; missionId: string; selections: SelectedModel[] }) {
  const mission = await db.getMissionForUser(input.userId, input.missionId);
  if (!mission) throw new Error("Mission not found.");
  const selections = validateRunPlan(mission.mode, input.selections);
  await db.updateMissionStatus(input.userId, mission.id, "queued");
  await db.createExecutionEvent({ userId: input.userId, missionId: mission.id, type: "MISSION_QUEUED", level: "info", summary: `${mission.mode === "competition" ? "Competition" : "Mission"} accepted with ${selections.length} model${selections.length === 1 ? "" : "s"}.` });
  await db.updateMissionStatus(input.userId, mission.id, "running");
  const outcomes = await Promise.all(selections.map(selection => executeRun({ userId: input.userId, missionId: mission.id, projectId: mission.projectId, mode: mission.mode, selection, command: mission.command, systemPrompt: mission.systemPrompt })));
  const successCount = outcomes.filter(outcome => outcome.status === "succeeded").length;
  const failureCount = outcomes.length - successCount;
  const status = resolveMissionStatus(successCount, failureCount);
  await db.updateMissionStatus(input.userId, mission.id, status);
  await db.createExecutionEvent({ userId: input.userId, missionId: mission.id, type: "MISSION_SETTLED", level: status === "failed" ? "error" : status === "partial" ? "warning" : "success", summary: `Mission ${status}: ${successCount} succeeded, ${failureCount} failed.`, metadata: { successCount, failureCount, status } });
  return db.getMissionDetail(input.userId, mission.id);
}

export async function retryRun(input: { userId: number; runId: string }) {
  const previous = await db.getRunForUser(input.userId, input.runId);
  if (!previous) throw new Error("Execution run not found.");
  const mission = await db.getMissionForUser(input.userId, previous.missionId);
  if (!mission) throw new Error("Mission not found.");
  await db.createExecutionEvent({ userId: input.userId, missionId: mission.id, runId: previous.id, type: "RETRY_REQUESTED", level: "info", summary: `Retry requested for ${previous.modelId}.` });
  await executeRun({ userId: input.userId, missionId: mission.id, projectId: mission.projectId, mode: mission.mode, selection: { providerId: previous.providerId as ProviderId, modelId: previous.modelId }, command: mission.command, systemPrompt: mission.systemPrompt });
  const detail = await db.getMissionDetail(input.userId, mission.id);
  if (!detail) throw new Error("Mission detail unavailable after retry.");
  const status = deriveMissionStatusFromLatestRuns(detail.runs);
  await db.updateMissionStatus(input.userId, mission.id, status);
  await db.createExecutionEvent({ userId: input.userId, missionId: mission.id, type: "RETRY_SETTLED", level: status === "completed" ? "success" : status === "partial" ? "warning" : "error", summary: `Retry settled: mission is ${status}.` });
  return db.getMissionDetail(input.userId, mission.id);
}
