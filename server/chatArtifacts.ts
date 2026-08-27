import * as db from "./db";
import { storagePut } from "./storage";

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 6;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "text/plain", "text/markdown", "text/csv", "text/html", "text/css",
  "application/json", "application/pdf", "application/javascript",
  "application/typescript", "application/sql", "application/xml",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  c: "text/plain", cc: "text/plain", cpp: "text/plain", css: "text/css", csv: "text/csv", go: "text/plain",
  html: "text/html", java: "text/plain", js: "application/javascript", json: "application/json", jsx: "text/plain",
  md: "text/markdown", pdf: "application/pdf", py: "text/plain", rb: "text/plain", rs: "text/plain", sh: "text/plain",
  sql: "application/sql", ts: "application/typescript", tsx: "text/plain", txt: "text/plain", xml: "application/xml",
  yml: "text/plain", yaml: "text/plain", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  bash: "sh", c: "c", cpp: "cpp", css: "css", csv: "csv", go: "go", html: "html",
  java: "java", javascript: "js", json: "json", jsx: "jsx", markdown: "md", md: "md",
  php: "php", python: "py", ruby: "rb", rust: "rs", sh: "sh", shell: "sh", sql: "sql",
  ts: "ts", typescript: "ts", tsx: "tsx", xml: "xml", yaml: "yml", yml: "yml",
};

export type ChatAttachmentSummary = { id: string; messageId: string | null; kind: "upload" | "generated_code"; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date };
export type StoredConversationAttachment = ChatAttachmentSummary & { storageKey: string };

export function sanitizeFileName(value: string) {
  const safe = value.replace(/\.{2,}/g, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/^-+|\.+$/g, "").slice(0, 180);
  return safe || "attachment";
}

export function isAllowedChatAttachment(mimeType: string) {
  return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
}

export function normalizeChatAttachmentMime(fileName: string, mimeType: string) {
  const provided = mimeType.toLowerCase().trim();
  if (isAllowedChatAttachment(provided)) return provided;
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXTENSION[extension] || null;
}

export function isImageAttachment(attachment: Pick<ChatAttachmentSummary, "mimeType">) {
  return attachment.mimeType.toLowerCase().startsWith("image/");
}

export function summarizeAttachment(attachment: { id: string; messageId: string | null; kind: "upload" | "generated_code"; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date; storageKey?: string }): ChatAttachmentSummary {
  return { id: attachment.id, messageId: attachment.messageId, kind: attachment.kind, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, createdAt: attachment.createdAt };
}

export function attachmentContext(attachments: ChatAttachmentSummary[]) {
  if (!attachments.length) return "";
  return `\n\nAttached files for this conversation message:\n${attachments.map(attachment => `- ${attachment.fileName} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`).join("\n")}\nTreat these as attachments. Do not claim their contents were read unless they were included in the written message.`;
}

export function extractCodeArtifacts(content: string) {
  const matches = Array.from(content.matchAll(/```([a-zA-Z0-9_+-]{0,32})?\s*\n([\s\S]*?)```/g));
  return matches.slice(0, MAX_CHAT_ATTACHMENTS_PER_MESSAGE).map((match, index) => {
    const language = (match[1] || "txt").toLowerCase();
    const code = match[2].replace(/^\n+|\n+$/g, "");
    const extension = EXTENSION_BY_LANGUAGE[language] || "txt";
    return { fileName: `godmode-code-${index + 1}.${extension}`, mimeType: extension === "json" ? "application/json" : extension === "html" ? "text/html" : extension === "css" ? "text/css" : extension === "md" ? "text/markdown" : "text/plain", code };
  }).filter(artifact => artifact.code.length > 0);
}

export async function createGeneratedCodeArtifacts(input: { userId: number; conversationId: string; messageId: string; content: string }) {
  const artifacts = extractCodeArtifacts(input.content);
  return Promise.all(artifacts.map(async artifact => {
    const bytes = Buffer.byteLength(artifact.code, "utf8");
    const stored = await storagePut(`godmode/${input.userId}/conversations/${input.conversationId}/generated/${artifact.fileName}`, artifact.code, artifact.mimeType);
    return db.createConversationAttachment({ userId: input.userId, conversationId: input.conversationId, messageId: input.messageId, kind: "generated_code", fileName: artifact.fileName, mimeType: artifact.mimeType, sizeBytes: bytes, storageKey: stored.key });
  }));
}

export async function requireDownloadableConversationAttachment(userId: number, attachmentId: string) {
  const attachment = await db.getConversationAttachmentForUser(userId, attachmentId);
  if (!attachment || !attachment.messageId) throw new Error("Attachment not found.");
  return attachment;
}
