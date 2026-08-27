import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { MAX_CHAT_ATTACHMENT_BYTES, normalizeChatAttachmentMime, sanitizeFileName, summarizeAttachment } from "../chatArtifacts";
import { storagePut } from "../storage";
import { retryChatMessage, sendChatMessage, validateChatSelections } from "../chatService";
import { executeMission, retryRun, validateRunPlan } from "../orchestration";
import { clearModelRegistryCache, connectProvider, disconnectProvider, getModelRegistry, ProviderId } from "../providerRegistry";
import { protectedProcedure, router } from "../_core/trpc";

const providerIdSchema = z.enum(["platform", "openrouter", "respan"]);
const selectedModelSchema = z.object({ providerId: providerIdSchema, modelId: z.string().min(1).max(255) });
const attachmentIdSchema = z.string().min(1).max(36);

function requireValue<T>(value: T | undefined, code: "NOT_FOUND" | "BAD_REQUEST" = "NOT_FOUND"): T {
  if (!value) throw new TRPCError({ code, message: code === "NOT_FOUND" ? "The requested workspace record was not found." : "The request could not be completed." });
  return value;
}

export const godmodeRouter = router({
  providers: router({
    list: protectedProcedure.query(({ ctx }) => getModelRegistry(ctx.user.id, { verifyOpenRouterAccess: true })),
    connect: protectedProcedure.input(z.object({ providerId: z.enum(["openrouter", "respan"]), apiKey: z.string().trim().min(8).max(1_000) })).mutation(({ ctx, input }) => connectProvider(ctx.user.id, input.providerId, input.apiKey)),
    disconnect: protectedProcedure.input(z.object({ providerId: z.enum(["openrouter", "respan"]) })).mutation(({ ctx, input }) => disconnectProvider(ctx.user.id, input.providerId)),
    refresh: protectedProcedure.mutation(({ ctx }) => { clearModelRegistryCache(ctx.user.id); return getModelRegistry(ctx.user.id, { force: true, verifyOpenRouterAccess: true }); }),
  }),
  models: router({
    list: protectedProcedure.query(async ({ ctx }) => getModelRegistry(ctx.user.id, { verifyOpenRouterAccess: true })),
    refresh: protectedProcedure.mutation(({ ctx }) => { clearModelRegistryCache(ctx.user.id); return getModelRegistry(ctx.user.id, { force: true, verifyOpenRouterAccess: true }); }),
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
      const [registry, runs] = await Promise.all([getModelRegistry(ctx.user.id), db.listRecentRuns(ctx.user.id)]);
      const errors = runs.filter(run => run.status === "failed");
      return { registry, runs, health: { availableModels: registry.models.length, healthyProviders: registry.diagnostics.filter(provider => provider.healthy).length, providerCount: registry.diagnostics.length, recentFailureCount: errors.length } };
    }),
  }),
  chat: router({
    list: protectedProcedure.query(({ ctx }) => db.listConversations(ctx.user.id)),
    detail: protectedProcedure.input(z.object({ conversationId: z.string().min(1).max(36) })).query(async ({ ctx, input }) => requireValue(await db.getConversationDetail(ctx.user.id, input.conversationId))),
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(180).optional(), systemPrompt: z.string().trim().max(60_000).optional(), respanFallback: z.boolean().optional() })).mutation(({ ctx, input }) => db.createConversation({ userId: ctx.user.id, ...input })),
    configure: protectedProcedure.input(z.object({ conversationId: z.string().min(1).max(36), systemPrompt: z.string().trim().max(60_000).nullable().optional(), mode: z.enum(["solo", "competition"]).optional(), selections: z.array(selectedModelSchema).min(1).max(6).optional(), respanFallback: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      requireValue(await db.getConversationForUser(ctx.user.id, input.conversationId));
      if (input.selections && input.mode) {
        try { validateChatSelections(input.mode, input.selections as Array<{ providerId: ProviderId; modelId: string }>); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid chat selection." }); }
      }
      await db.updateConversationConfiguration({ userId: ctx.user.id, conversationId: input.conversationId, systemPrompt: input.systemPrompt, mode: input.mode, selectedModels: input.selections ? JSON.stringify(input.selections) : undefined, respanFallback: input.respanFallback });
      return requireValue(await db.getConversationDetail(ctx.user.id, input.conversationId));
    }),
    upload: protectedProcedure.input(z.object({ conversationId: z.string().min(1).max(36), fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(120), base64: z.string().min(1).max(14_000_000) })).mutation(async ({ ctx, input }) => {
      requireValue(await db.getConversationForUser(ctx.user.id, input.conversationId));
      const mimeType = normalizeChatAttachmentMime(input.fileName, input.mimeType);
      if (!mimeType) throw new TRPCError({ code: "BAD_REQUEST", message: "This file type is not supported. Use PNG, JPG, WEBP, GIF, PDF, Office documents, text, Markdown, CSV, JSON, or common code files." });
      const bytes = Buffer.from(input.base64, "base64");
      if (!bytes.length || bytes.length > MAX_CHAT_ATTACHMENT_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachments must be between 1 byte and 10 MB." });
      const fileName = sanitizeFileName(input.fileName);
      const stored = await storagePut(`godmode/${ctx.user.id}/conversations/${input.conversationId}/uploads/${fileName}`, bytes, mimeType);
      const attachment = await db.createConversationAttachment({ userId: ctx.user.id, conversationId: input.conversationId, kind: "upload", fileName, mimeType, sizeBytes: bytes.length, storageKey: stored.key });
      return summarizeAttachment(attachment);
    }),
    removePendingAttachment: protectedProcedure.input(z.object({ attachmentId: attachmentIdSchema })).mutation(async ({ ctx, input }) => ({ removed: await db.removePendingConversationAttachment(ctx.user.id, input.attachmentId) })),
    send: protectedProcedure.input(z.object({ conversationId: z.string().min(1).max(36), content: z.string().trim().min(1).max(32_000), mode: z.enum(["solo", "competition"]), selections: z.array(selectedModelSchema).min(1).max(6), attachmentIds: z.array(attachmentIdSchema).max(6).optional(), fast: z.boolean().optional(), research: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      try { return await sendChatMessage({ userId: ctx.user.id, conversationId: input.conversationId, content: input.content, mode: input.mode, selections: input.selections as Array<{ providerId: ProviderId; modelId: string }>, attachmentIds: input.attachmentIds, fast: input.fast, research: input.research }); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Chat request failed." }); }
    }),
    retry: protectedProcedure.input(z.object({ messageId: z.string().min(1).max(36) })).mutation(async ({ ctx, input }) => {
      try { return await retryChatMessage({ userId: ctx.user.id, messageId: input.messageId }); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Retry failed." }); }
    }),
  }),
});
