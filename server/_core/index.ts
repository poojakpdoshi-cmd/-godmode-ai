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
import { prepareStreamedChat, persistStreamedAssistantMessage, persistStreamedFailure } from "../chatService";
import { streamConfiguredModel } from "../providerRegistry";

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
  app.post("/api/godmode/stream", async (req, res) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) { res.status(401).json({ error: "Authentication required." }); return; }
    const input = req.body as { conversationId?: string; content?: string; selection?: { providerId?: string; modelId?: string } };
    if (!input.conversationId || !input.content?.trim() || input.content.length > 32_000 || input.selection?.providerId !== "openrouter" || !input.selection.modelId) { res.status(400).json({ error: "Invalid streaming chat request." }); return; }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const write = (event: string, payload: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    let plan: Awaited<ReturnType<typeof prepareStreamedChat>> | null = null;
    let startedAt = Date.now();
    try {
      plan = await prepareStreamedChat({ userId: user.id, conversationId: input.conversationId, content: input.content, selection: { providerId: "openrouter", modelId: input.selection.modelId } });
      write("meta", { modelId: plan.selection.modelId });
      startedAt = Date.now();
      const result = await streamConfiguredModel({ userId: user.id, providerId: plan.selection.providerId, modelId: plan.selection.modelId, messages: plan.messages }, (chunk: string) => write("delta", { chunk }));
      const latencyMs = Date.now() - startedAt;
      await persistStreamedAssistantMessage({ userId: user.id, conversationId: plan.conversationId, userMessageId: plan.userMessageId, selection: plan.selection, output: result.output, latencyMs, usage: result.usage });
      write("done", { latencyMs, usage: result.usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Streaming request failed.";
      if (plan) await persistStreamedFailure({ userId: user.id, conversationId: plan.conversationId, userMessageId: plan.userMessageId, selection: plan.selection, errorMessage: message, latencyMs: Date.now() - startedAt }).catch(() => undefined);
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

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
