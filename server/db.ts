import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  executionEvents,
  executionRuns,
  InsertUser,
  conversationMessages,
  conversations,
  missions,
  missionMessages,
  projects,
  providerConfigurations,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    _db = drizzle(process.env.DATABASE_URL);
  }
  return _db;
}

function id() {
  return nanoid(21);
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  (["name", "email", "loginMethod"] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
}

export async function listProjects(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function createProject(input: { userId: number; name: string; description?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const project = { id: id(), userId: input.userId, name: input.name, description: input.description ?? null };
  await db.insert(projects).values(project);
  return project;
}

export async function getProjectForUser(userId: number, projectId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1))[0];
}

export async function listMissions(userId: number, projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(missions).where(and(eq(missions.userId, userId), eq(missions.projectId, projectId))).orderBy(desc(missions.createdAt));
}

export async function createMission(input: {
  userId: number;
  projectId: string;
  title: string;
  command: string;
  systemPrompt?: string;
  mode: "solo" | "competition";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const mission = {
    id: id(),
    userId: input.userId,
    projectId: input.projectId,
    title: input.title,
    command: input.command,
    systemPrompt: input.systemPrompt ?? null,
    mode: input.mode,
    status: "draft" as const,
  };
  await db.insert(missions).values(mission);
  await db.insert(missionMessages).values({ id: id(), missionId: mission.id, userId: input.userId, role: "user", content: input.command });
  return mission;
}

export async function getMissionForUser(userId: number, missionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(missions).where(and(eq(missions.id, missionId), eq(missions.userId, userId))).limit(1))[0];
}

export async function updateMissionStatus(userId: number, missionId: string, status: "queued" | "running" | "completed" | "partial" | "failed") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(missions).set({ status }).where(and(eq(missions.id, missionId), eq(missions.userId, userId)));
}

export async function createRun(input: {
  userId: number;
  missionId: string;
  projectId: string;
  providerId: string;
  modelId: string;
  mode: "solo" | "competition";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const run = { id: id(), ...input, status: "queued" as const };
  await db.insert(executionRuns).values(run);
  return run;
}

export async function updateRunStarted(userId: number, runId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(executionRuns).set({ status: "running", startedAt: new Date() }).where(and(eq(executionRuns.id, runId), eq(executionRuns.userId, userId)));
}

export async function updateRunSucceeded(userId: number, runId: string, result: { output: string; latencyMs: number; promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(executionRuns).set({ status: "succeeded", output: result.output, latencyMs: result.latencyMs, promptTokens: result.promptTokens ?? null, completionTokens: result.completionTokens ?? null, totalTokens: result.totalTokens ?? null, completedAt: new Date(), errorCode: null, errorMessage: null }).where(and(eq(executionRuns.id, runId), eq(executionRuns.userId, userId)));
}

export async function updateRunFailed(userId: number, runId: string, errorMessage: string, latencyMs: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(executionRuns).set({ status: "failed", errorCode: "PROVIDER_REQUEST_FAILED", errorMessage, latencyMs, completedAt: new Date() }).where(and(eq(executionRuns.id, runId), eq(executionRuns.userId, userId)));
}

export async function createExecutionEvent(input: { userId: number; missionId: string; runId?: string; type: string; level: "info" | "success" | "warning" | "error"; summary: string; detail?: string; metadata?: Record<string, unknown> }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(executionEvents).values({ id: id(), userId: input.userId, missionId: input.missionId, runId: input.runId ?? null, type: input.type, level: input.level, summary: input.summary, detail: input.detail ?? null, metadata: input.metadata ? JSON.stringify(input.metadata) : null });
}

export async function getRunForUser(userId: number, runId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(executionRuns).where(and(eq(executionRuns.id, runId), eq(executionRuns.userId, userId))).limit(1))[0];
}

export async function getMissionDetail(userId: number, missionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const mission = await getMissionForUser(userId, missionId);
  if (!mission) return undefined;
  const [runs, events, messages] = await Promise.all([
    db.select().from(executionRuns).where(and(eq(executionRuns.missionId, missionId), eq(executionRuns.userId, userId))).orderBy(desc(executionRuns.createdAt)),
    db.select().from(executionEvents).where(and(eq(executionEvents.missionId, missionId), eq(executionEvents.userId, userId))).orderBy(desc(executionEvents.createdAt)),
    db.select().from(missionMessages).where(and(eq(missionMessages.missionId, missionId), eq(missionMessages.userId, userId))).orderBy(desc(missionMessages.createdAt)),
  ]);
  return { mission, runs, events, messages };
}

export async function listRecentRuns(userId: number, limit = 12) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(executionRuns).where(eq(executionRuns.userId, userId)).orderBy(desc(executionRuns.createdAt)).limit(limit);
}

export async function listProviderConfigurations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(providerConfigurations).where(eq(providerConfigurations.userId, userId));
}

export async function getProviderConfiguration(userId: number, providerId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(providerConfigurations).where(and(eq(providerConfigurations.userId, userId), eq(providerConfigurations.providerId, providerId))).limit(1))[0];
}

export async function upsertProviderConfiguration(input: {
  userId: number;
  providerId: string;
  displayName: string;
  credentialEncrypted: string;
  lastError?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await getProviderConfiguration(input.userId, input.providerId);
  const values = {
    displayName: input.displayName,
    credentialSource: "encrypted_user_key" as const,
    credentialEncrypted: input.credentialEncrypted,
    isEnabled: "yes" as const,
    lastCheckedAt: new Date(),
    lastError: input.lastError ?? null,
  };
  if (existing) {
    await db.update(providerConfigurations).set(values).where(eq(providerConfigurations.id, existing.id));
    return { ...existing, ...values };
  }
  const configuration = { id: id(), userId: input.userId, providerId: input.providerId, ...values };
  await db.insert(providerConfigurations).values(configuration);
  return configuration;
}

export async function disableProviderConfiguration(userId: number, providerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(providerConfigurations).set({ isEnabled: "no", credentialEncrypted: null, lastError: null, lastCheckedAt: new Date() }).where(and(eq(providerConfigurations.userId, userId), eq(providerConfigurations.providerId, providerId)));
}

export async function createConversation(input: { userId: number; title?: string; systemPrompt?: string; mode?: "solo" | "competition"; selectedModels?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const conversation = {
    id: id(),
    userId: input.userId,
    title: input.title?.trim() || "New conversation",
    systemPrompt: input.systemPrompt?.trim() || null,
    mode: input.mode ?? "solo",
    selectedModels: input.selectedModels ?? "[]",
  };
  await db.insert(conversations).values(conversation);
  return conversation;
}

export async function listConversations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
}

export async function getConversationForUser(userId: number, conversationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1))[0];
}

export async function updateConversationConfiguration(input: { userId: number; conversationId: string; systemPrompt?: string | null; mode?: "solo" | "competition"; selectedModels?: string; title?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const values: { systemPrompt?: string | null; mode?: "solo" | "competition"; selectedModels?: string; title?: string } = {};
  if (input.systemPrompt !== undefined) values.systemPrompt = input.systemPrompt;
  if (input.mode !== undefined) values.mode = input.mode;
  if (input.selectedModels !== undefined) values.selectedModels = input.selectedModels;
  if (input.title !== undefined) values.title = input.title;
  if (Object.keys(values).length) {
    await db.update(conversations).set(values).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)));
  }
}

export async function updateConversationTitle(userId: number, conversationId: string, title: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(conversations).set({ title }).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

export async function appendConversationMessage(input: {
  userId: number;
  conversationId: string;
  replyToMessageId?: string;
  role: "user" | "assistant";
  content: string;
  providerId?: string;
  modelId?: string;
  status?: "completed" | "failed";
  errorMessage?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const message = {
    id: id(),
    userId: input.userId,
    conversationId: input.conversationId,
    replyToMessageId: input.replyToMessageId ?? null,
    role: input.role,
    content: input.content,
    providerId: input.providerId ?? null,
    modelId: input.modelId ?? null,
    status: input.status ?? "completed" as const,
    errorMessage: input.errorMessage ?? null,
    latencyMs: input.latencyMs ?? null,
    promptTokens: input.promptTokens ?? null,
    completionTokens: input.completionTokens ?? null,
    totalTokens: input.totalTokens ?? null,
  };
  await db.insert(conversationMessages).values(message);
  await db.update(conversations).set({ updatedAt: new Date() }).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)));
  return message;
}

export async function listConversationMessages(userId: number, conversationId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.userId, userId))).orderBy(asc(conversationMessages.createdAt));
}

export async function getConversationMessageForUser(userId: number, messageId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(conversationMessages).where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.userId, userId))).limit(1))[0];
}

export async function getConversationDetail(userId: number, conversationId: string) {
  const conversation = await getConversationForUser(userId, conversationId);
  if (!conversation) return undefined;
  const messages = await listConversationMessages(userId, conversationId);
  return { conversation, messages };
}
