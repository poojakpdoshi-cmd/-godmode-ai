import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { getOrCreateLocalUser } from "../db";
import { prepareStreamedChat, persistStreamedAssistantMessage, persistStreamedFailure } from "../chatService";
import { canUseRespanFallback, getFastFreeCandidates, getRespanFallbackModel, streamConfiguredModel } from "../providerRegistry";
import { requireDownloadableConversationAttachment, sanitizeFileName } from "../chatArtifacts";
import { storageGetSignedUrl } from "../storage";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/godmode/attachments/:attachmentId/download", async (req, res) => {
    const user = ENV.localMode ? await getOrCreateLocalUser().catch(() => null) : await sdk.authenticateRequest(req).catch(() => null);
    if (!user) { res.status(401).json({ error: "Authentication required." }); return; }
    const attachment = await requireDownloadableConversationAttachment(user.id, req.params.attachmentId).catch(() => undefined);
    if (!attachment) { res.status(404).json({ error: "Attachment not found." }); return; }
    try {
      const upstream = await fetch(await storageGetSignedUrl(attachment.storageKey));
      if (!upstream.ok) throw new Error("Stored attachment could not be read.");
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Length", String(bytes.length));
      const disposition = attachment.mimeType.startsWith("image/") && req.query.inline === "1" ? "inline" : "attachment";
      res.setHeader("Content-Disposition", `${disposition}; filename="${sanitizeFileName(attachment.fileName).replace(/"/g, "")}"`);
      res.status(200).send(bytes);
    } catch {
      res.status(502).json({ error: "The stored attachment is temporarily unavailable. Retry the download." });
    }
  });
  app.post("/api/godmode/stream", async (req, res) => {
    const user = ENV.localMode ? await getOrCreateLocalUser().catch(() => null) : await sdk.authenticateRequest(req).catch(() => null);
    if (!user) { res.status(401).json({ error: "Authentication required." }); return; }
    const input = req.body as { conversationId?: string; content?: string; attachmentIds?: unknown; selection?: { providerId?: string; modelId?: string } };
    if (!input.conversationId || !input.content?.trim() || input.content.length > 32_000 || (input.selection?.providerId !== "openrouter" && input.selection?.providerId !== "nvidia") || !input.selection.modelId) { res.status(400).json({ error: "Invalid streaming chat request." }); return; }
    const attachmentIds = Array.isArray(input.attachmentIds) && input.attachmentIds.length <= 6 && input.attachmentIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 36) ? input.attachmentIds : undefined;
    if (input.attachmentIds !== undefined && !attachmentIds) { res.status(400).json({ error: "Invalid attachment list." }); return; }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const write = (event: string, payload: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    let plan: Awaited<ReturnType<typeof prepareStreamedChat>> | null = null;
    let startedAt = Date.now();
    let finalSelection: { providerId: "openrouter" | "respan" | "nvidia"; modelId: string } | null = null;
    try {
      plan = await prepareStreamedChat({ userId: user.id, conversationId: input.conversationId, content: input.content, attachmentIds, selection: { providerId: input.selection.providerId, modelId: input.selection.modelId } });
      let result: Awaited<ReturnType<typeof streamConfiguredModel>> | null = null;
      let firstTokenMs: number | null = null;
      let lastError: Error | null = null;
      if (plan.selection.providerId === "nvidia") {
        const nvidiaSelection = { providerId: "nvidia" as const, modelId: plan.selection.modelId };
        finalSelection = nvidiaSelection;
        startedAt = Date.now();
        write("meta", { providerId: nvidiaSelection.providerId, modelId: nvidiaSelection.modelId, attempt: 1, candidateCount: 1 });
        result = await streamConfiguredModel({ userId: user.id, providerId: nvidiaSelection.providerId, modelId: nvidiaSelection.modelId, messages: plan.messages }, (chunk: string) => {
          if (firstTokenMs === null) { firstTokenMs = Date.now() - startedAt; write("first-token", { firstTokenMs, providerId: nvidiaSelection.providerId, modelId: nvidiaSelection.modelId }); }
          write("delta", { chunk });
        });
      } else {
        try {
          const candidates = await getFastFreeCandidates(user.id);
          if (!candidates.length) throw new Error("No verified free OpenRouter model is available for fast routing.");
          for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            let emitted = false;
            finalSelection = { providerId: "openrouter", modelId: candidate.modelId };
            write("meta", { providerId: finalSelection.providerId, modelId: finalSelection.modelId, attempt: index + 1, candidateCount: candidates.length });
            startedAt = Date.now();
            try {
              result = await streamConfiguredModel({ userId: user.id, providerId: finalSelection.providerId, modelId: finalSelection.modelId, messages: plan.messages }, (chunk: string) => {
                emitted = true;
                if (firstTokenMs === null) { firstTokenMs = Date.now() - startedAt; write("first-token", { firstTokenMs, providerId: finalSelection!.providerId, modelId: finalSelection!.modelId }); }
                write("delta", { chunk });
              });
              break;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error("Free model attempt failed.");
              if (emitted) throw lastError;
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Free model attempt failed.");
        }
        if (!result && lastError && canUseRespanFallback(plan.respanFallbackEnabled, lastError)) {
          const fallback = await getRespanFallbackModel(user.id);
          finalSelection = { providerId: "respan", modelId: fallback.modelId };
          firstTokenMs = null;
          startedAt = Date.now();
          write("status", { message: `OpenRouter is unavailable (${lastError.message}); switching to your connected Respan fallback.` });
          write("meta", { providerId: finalSelection.providerId, modelId: finalSelection.modelId, attempt: 1, candidateCount: 1 });
          result = await streamConfiguredModel({ userId: user.id, providerId: finalSelection.providerId, modelId: finalSelection.modelId, messages: plan.messages }, (chunk: string) => {
            if (firstTokenMs === null) { firstTokenMs = Date.now() - startedAt; write("first-token", { firstTokenMs, providerId: finalSelection!.providerId, modelId: finalSelection!.modelId }); }
            write("delta", { chunk });
          });
        }
      }
      if (!result) throw lastError ?? new Error("All available free models were congested.");
      const latencyMs = Date.now() - startedAt;
      if (!finalSelection) throw new Error("No active provider selection was available for this stream.");
      await persistStreamedAssistantMessage({ userId: user.id, conversationId: plan.conversationId, userMessageId: plan.userMessageId, selection: finalSelection, output: result.output, firstTokenMs, latencyMs, usage: result.usage });
      write("done", { latencyMs, firstTokenMs, modelId: finalSelection.modelId, providerId: finalSelection.providerId, usage: result.usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Streaming request failed.";
      if (plan) await persistStreamedFailure({ userId: user.id, conversationId: plan.conversationId, userMessageId: plan.userMessageId, selection: finalSelection ?? plan.selection, errorMessage: message, latencyMs: Date.now() - startedAt }).catch(() => undefined);
      write("error", { message });
    } finally {
      res.end();
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, ENV.localMode ? "127.0.0.1" : undefined, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
