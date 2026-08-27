import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const db = vi.hoisted(() => ({ getConversationForUser: vi.fn(), createConversationAttachment: vi.fn(), removePendingConversationAttachment: vi.fn() }));
const storage = vi.hoisted(() => ({ storagePut: vi.fn() }));
vi.mock("./db", () => db);
vi.mock("./storage", () => storage);
vi.mock("./chatArtifacts", () => ({ MAX_CHAT_ATTACHMENT_BYTES: 10 * 1024 * 1024, normalizeChatAttachmentMime: (fileName: string, mimeType: string) => mimeType === "text/plain" || fileName.endsWith(".txt") ? "text/plain" : null, sanitizeFileName: (value: string) => value.replace(/[^a-zA-Z0-9.]+/g, "-"), summarizeAttachment: (value: unknown) => value }));
vi.mock("./chatService", () => ({ retryChatMessage: vi.fn(), sendChatMessage: vi.fn(), validateChatSelections: vi.fn() }));
vi.mock("./orchestration", () => ({ executeMission: vi.fn(), retryRun: vi.fn(), validateRunPlan: vi.fn() }));
vi.mock("./providerRegistry", () => ({ clearModelRegistryCache: vi.fn(), connectProvider: vi.fn(), disconnectProvider: vi.fn(), getModelRegistry: vi.fn() }));

import { godmodeRouter } from "./routers/godmode";

const operator = { id: 41, openId: "operator-41", name: "Operator", email: "operator@example.com", loginMethod: "manus", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const context = (user: TrpcContext["user"]): TrpcContext => ({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });

describe("chat attachment routes", () => {
  it("requires an authenticated user before accepting an upload", async () => {
    const caller = godmodeRouter.createCaller(context(null));
    await expect(caller.chat.upload({ conversationId: "thread-1", fileName: "notes.txt", mimeType: "text/plain", base64: "aGVsbG8=" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unsupported file types before object storage is called", async () => {
    db.getConversationForUser.mockResolvedValue({ id: "thread-1" });
    const caller = godmodeRouter.createCaller(context(operator));
    await expect(caller.chat.upload({ conversationId: "thread-1", fileName: "unsafe.exe", mimeType: "application/x-msdownload", base64: "aGVsbG8=" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storagePut).not.toHaveBeenCalled();
  });

  it("stores a validated upload under the authenticated user and removes pending files with that same user scope", async () => {
    db.getConversationForUser.mockResolvedValue({ id: "thread-1" });
    storage.storagePut.mockResolvedValue({ key: "godmode/41/conversations/thread-1/uploads/notes.txt" });
    db.createConversationAttachment.mockResolvedValue({ id: "attachment-1", messageId: null, kind: "upload", fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 5, storageKey: "safe-key", createdAt: new Date() });
    db.removePendingConversationAttachment.mockResolvedValue(true);
    const caller = godmodeRouter.createCaller(context(operator));
    await caller.chat.upload({ conversationId: "thread-1", fileName: "notes.txt", mimeType: "text/plain", base64: "aGVsbG8=" });
    expect(storage.storagePut).toHaveBeenCalledWith("godmode/41/conversations/thread-1/uploads/notes.txt", expect.any(Buffer), "text/plain");
    expect(db.createConversationAttachment).toHaveBeenCalledWith(expect.objectContaining({ userId: 41, conversationId: "thread-1", kind: "upload", sizeBytes: 5 }));
    await caller.chat.removePendingAttachment({ attachmentId: "attachment-1" });
    expect(db.removePendingConversationAttachment).toHaveBeenCalledWith(41, "attachment-1");
  });
});
