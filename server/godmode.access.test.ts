import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getProjectForUser: vi.fn(),
  listMissions: vi.fn(),
}));

vi.mock("./db", () => ({
  ...dbMocks,
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getConversationDetail: vi.fn(),
  getMissionDetail: vi.fn(),
  getMissionForUser: vi.fn(),
  createMission: vi.fn(),
  listRecentRuns: vi.fn(),
}));

vi.mock("./orchestration", () => ({
  executeMission: vi.fn(),
  retryRun: vi.fn(),
  validateRunPlan: vi.fn(),
}));

vi.mock("./providerRegistry", () => ({
  clearModelRegistryCache: vi.fn(),
  getModelRegistry: vi.fn(),
}));

import { godmodeRouter } from "./routers/godmode";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

const operator = {
  id: 41,
  openId: "operator-41",
  name: "Operator",
  email: "operator@example.com",
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("GODMODE user-scoped access", () => {
  it("rejects all workspace procedures without an authenticated user", async () => {
    const caller = godmodeRouter.createCaller(context(null));
    await expect(caller.projects.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
  });

  it("checks ownership using the authenticated operator id before listing a project’s missions", async () => {
    dbMocks.getProjectForUser.mockResolvedValueOnce(undefined);
    const caller = godmodeRouter.createCaller(context(operator));
    await expect(caller.missions.list({ projectId: "another-user-project" })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
    expect(dbMocks.getProjectForUser).toHaveBeenCalledWith(operator.id, "another-user-project");
    expect(dbMocks.listMissions).not.toHaveBeenCalled();
  });

  it("rejects chat detail requests that do not belong to the authenticated user", async () => {
    const dbModule = await import("./db");
    vi.mocked(dbModule.getConversationDetail).mockResolvedValueOnce(undefined);
    const caller = godmodeRouter.createCaller(context(operator));
    await expect(caller.chat.detail({ conversationId: "another-user-thread" })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
    expect(dbModule.getConversationDetail).toHaveBeenCalledWith(operator.id, "another-user-thread");
  });
});
