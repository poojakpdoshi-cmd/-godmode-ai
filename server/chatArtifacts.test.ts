import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ createConversationAttachment: vi.fn(), getConversationAttachmentForUser: vi.fn() }));
const storage = vi.hoisted(() => ({ storagePut: vi.fn() }));
vi.mock("./db", () => db);
vi.mock("./storage", () => storage);

import { createGeneratedCodeArtifacts, extractCodeArtifacts, isAllowedChatAttachment, MAX_CHAT_ATTACHMENT_BYTES, normalizeChatAttachmentMime, requireDownloadableConversationAttachment, sanitizeFileName } from "./chatArtifacts";

describe("chat artifacts", () => {
  it("accepts only supported attachment types and normalizes untrusted filenames", () => {
    expect(isAllowedChatAttachment("image/png")).toBe(true);
    expect(isAllowedChatAttachment("application/x-msdownload")).toBe(false);
    expect(normalizeChatAttachmentMime("script.py", "")).toBe("text/plain");
    expect(normalizeChatAttachmentMime("unsafe.exe", "application/x-msdownload")).toBeNull();
    expect(sanitizeFileName("../../secrets\\api:key?.ts")).toBe("secrets-api-key-.ts");
    expect(MAX_CHAT_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("extracts explicit fenced code blocks into predictable downloadable file artifacts", () => {
    expect(extractCodeArtifacts("Here is the file:\n```typescript\nexport const ready = true;\n```"))
      .toEqual([{ fileName: "godmode-code-1.ts", mimeType: "text/plain", code: "export const ready = true;" }]);
  });

  it("stores generated code as an object-storage artifact bound to the assistant message", async () => {
    storage.storagePut.mockResolvedValue({ key: "godmode/7/code.ts" });
    db.createConversationAttachment.mockResolvedValue({ id: "artifact-1" });
    await createGeneratedCodeArtifacts({ userId: 7, conversationId: "conversation-1", messageId: "assistant-1", content: "```ts\nexport const value = 1;\n```" });
    expect(storage.storagePut).toHaveBeenCalledWith(expect.stringContaining("godmode/7/conversations/conversation-1/generated/godmode-code-1.ts"), "export const value = 1;", "text/plain");
    expect(db.createConversationAttachment).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, conversationId: "conversation-1", messageId: "assistant-1", kind: "generated_code", fileName: "godmode-code-1.ts" }));
  });

  it("allows download only for the authenticated owner and only after an attachment is bound to a message", async () => {
    db.getConversationAttachmentForUser.mockResolvedValueOnce({ id: "attachment-1", messageId: "message-1", userId: 7, storageKey: "safe-key" });
    await expect(requireDownloadableConversationAttachment(7, "attachment-1")).resolves.toMatchObject({ id: "attachment-1" });
    expect(db.getConversationAttachmentForUser).toHaveBeenCalledWith(7, "attachment-1");
    db.getConversationAttachmentForUser.mockResolvedValueOnce({ id: "attachment-2", messageId: null, userId: 7 });
    await expect(requireDownloadableConversationAttachment(7, "attachment-2")).rejects.toThrow("Attachment not found.");
  });
});
