import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { executeMission, retryRun, validateRunPlan } from "../orchestration";
import { clearModelRegistryCache, getModelRegistry, ProviderId } from "../providerRegistry";
import { protectedProcedure, router } from "../_core/trpc";

const providerIdSchema = z.enum(["platform", "openrouter"]);
const selectedModelSchema = z.object({ providerId: providerIdSchema, modelId: z.string().min(1).max(255) });

function requireValue<T>(value: T | undefined, code: "NOT_FOUND" | "BAD_REQUEST" = "NOT_FOUND"): T {
  if (!value) throw new TRPCError({ code, message: code === "NOT_FOUND" ? "The requested workspace record was not found." : "The request could not be completed." });
  return value;
}

export const godmodeRouter = router({
  models: router({
    list: protectedProcedure.query(async () => getModelRegistry()),
    refresh: protectedProcedure.mutation(async () => {
      clearModelRegistryCache();
      return getModelRegistry({ force: true });
    }),
  }),
  projects: router({
    list: protectedProcedure.query(({ ctx }) => db.listProjects(ctx.user.id)),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(2).max(180), description: z.string().trim().max(1_000).optional() })).mutation(({ ctx, input }) => db.createProject({ userId: ctx.user.id, ...input })),
  }),
  missions: router({
    list: protectedProcedure.input(z.object({ projectId: z.string().min(1).max(36) })).query(async ({ ctx, input }) => {
      requireValue(await db.getProjectForUser(ctx.user.id, input.projectId));
      return db.listMissions(ctx.user.id, input.projectId);
    }),
    detail: protectedProcedure.input(z.object({ missionId: z.string().min(1).max(36) })).query(async ({ ctx, input }) => requireValue(await db.getMissionDetail(ctx.user.id, input.missionId))),
    create: protectedProcedure.input(z.object({ projectId: z.string().min(1).max(36), title: z.string().trim().min(2).max(180), command: z.string().trim().min(1).max(32_000), systemPrompt: z.string().trim().max(16_000).optional(), mode: z.enum(["solo", "competition"]) })).mutation(async ({ ctx, input }) => {
      requireValue(await db.getProjectForUser(ctx.user.id, input.projectId));
      return db.createMission({ userId: ctx.user.id, ...input });
    }),
    execute: protectedProcedure.input(z.object({ missionId: z.string().min(1).max(36), selections: z.array(selectedModelSchema).min(1).max(6) })).mutation(async ({ ctx, input }) => {
      const mission = requireValue(await db.getMissionForUser(ctx.user.id, input.missionId));
      try {
        validateRunPlan(mission.mode, input.selections);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid model selection." });
      }
      return executeMission({ userId: ctx.user.id, missionId: input.missionId, selections: input.selections as Array<{ providerId: ProviderId; modelId: string }> });
    }),
    retry: protectedProcedure.input(z.object({ runId: z.string().min(1).max(36) })).mutation(({ ctx, input }) => retryRun({ userId: ctx.user.id, runId: input.runId })),
  }),
  operations: router({
    summary: protectedProcedure.query(async ({ ctx }) => {
      const [registry, runs] = await Promise.all([getModelRegistry(), db.listRecentRuns(ctx.user.id)]);
      const errors = runs.filter(run => run.status === "failed");
      return { registry, runs, health: { availableModels: registry.models.length, healthyProviders: registry.diagnostics.filter(provider => provider.healthy).length, providerCount: registry.diagnostics.length, recentFailureCount: errors.length } };
    }),
  }),
});
