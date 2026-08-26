import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const projects = mysqlTable(
  "projects",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("projects_user_created_idx").on(table.userId, table.createdAt)]
);

export const missions = mysqlTable(
  "missions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    command: text("command").notNull(),
    systemPrompt: text("systemPrompt"),
    mode: mysqlEnum("mode", ["solo", "competition"]).notNull(),
    status: mysqlEnum("status", ["draft", "queued", "running", "completed", "partial", "failed"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("missions_user_created_idx").on(table.userId, table.createdAt),
    index("missions_project_created_idx").on(table.projectId, table.createdAt),
  ]
);

export const missionMessages = mysqlTable(
  "missionMessages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    missionId: varchar("missionId", { length: 36 }).notNull().references(() => missions.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["user", "system", "assistant"]).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("mission_messages_mission_created_idx").on(table.missionId, table.createdAt)]
);

export const executionRuns = mysqlTable(
  "executionRuns",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    missionId: varchar("missionId", { length: 36 }).notNull().references(() => missions.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 36 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    providerId: varchar("providerId", { length: 64 }).notNull(),
    modelId: varchar("modelId", { length: 255 }).notNull(),
    mode: mysqlEnum("mode", ["solo", "competition"]).notNull(),
    status: mysqlEnum("status", ["queued", "running", "succeeded", "failed"])
      .default("queued")
      .notNull(),
    output: text("output"),
    errorCode: varchar("errorCode", { length: 80 }),
    errorMessage: text("errorMessage"),
    latencyMs: int("latencyMs"),
    promptTokens: int("promptTokens"),
    completionTokens: int("completionTokens"),
    totalTokens: int("totalTokens"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("runs_mission_created_idx").on(table.missionId, table.createdAt),
    index("runs_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const executionEvents = mysqlTable(
  "executionEvents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    missionId: varchar("missionId", { length: 36 }).notNull().references(() => missions.id, { onDelete: "cascade" }),
    runId: varchar("runId", { length: 36 }).references(() => executionRuns.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    level: mysqlEnum("level", ["info", "success", "warning", "error"]).notNull(),
    summary: varchar("summary", { length: 300 }).notNull(),
    detail: text("detail"),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("events_mission_created_idx").on(table.missionId, table.createdAt),
    index("events_run_created_idx").on(table.runId, table.createdAt),
  ]
);

export const providerConfigurations = mysqlTable(
  "providerConfigurations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    providerId: varchar("providerId", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 120 }).notNull(),
    credentialSource: mysqlEnum("credentialSource", ["platform", "environment", "encrypted_user_key"]).notNull(),
    credentialEncrypted: text("credentialEncrypted"),
    isEnabled: mysqlEnum("isEnabled", ["yes", "no"]).default("yes").notNull(),
    lastCheckedAt: timestamp("lastCheckedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("provider_configs_user_provider_uq").on(table.userId, table.providerId)]
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    systemPrompt: text("systemPrompt"),
    mode: mysqlEnum("mode", ["solo", "competition"]).default("solo").notNull(),
    selectedModels: text("selectedModels").notNull(),
    respanFallback: mysqlEnum("respanFallback", ["yes", "no"]).default("no").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("conversations_user_updated_idx").on(table.userId, table.updatedAt)]
);

export const conversationMessages = mysqlTable(
  "conversationMessages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    replyToMessageId: varchar("replyToMessageId", { length: 36 }),
    role: mysqlEnum("role", ["user", "assistant"]).notNull(),
    content: text("content").notNull(),
    providerId: varchar("providerId", { length: 64 }),
    modelId: varchar("modelId", { length: 255 }),
    researchMode: mysqlEnum("researchMode", ["yes", "no"]).default("no").notNull(),
    status: mysqlEnum("status", ["completed", "failed"]).default("completed").notNull(),
    errorMessage: text("errorMessage"),
    firstTokenMs: int("firstTokenMs"),
    latencyMs: int("latencyMs"),
    promptTokens: int("promptTokens"),
    completionTokens: int("completionTokens"),
    totalTokens: int("totalTokens"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("conversation_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("conversation_messages_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type Mission = typeof missions.$inferSelect;
export type ExecutionRun = typeof executionRuns.$inferSelect;
export type ExecutionEvent = typeof executionEvents.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
