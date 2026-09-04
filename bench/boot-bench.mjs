/**
 * Cold-start and request-overhead measurement.
 * Boots each mode, polls for the readiness line, then times HTTP responses.
 *   node bench/boot-bench.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname;

function startChild(command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { output: "", readyAt: null };
  const onData = chunk => {
    state.output += chunk.toString();
    if (!state.readyAt && state.output.includes("Server running on"))
      state.readyAt = Date.now();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return { child, state };
}

async function timedFetch(url, timeoutMs = 20_000) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    return {
      ms: performance.now() - started,
      bytes: body.length,
      status: response.status,
    };
  } catch (error) {
    return {
      ms: performance.now() - started,
      bytes: 0,
      status: `ERR ${error.name}`,
    };
  }
}

async function measure({ name, command, args, env, port, maxWaitMs }) {
  process.stdout.write(`\n--- ${name} ---\n`);
  const startedAt = Date.now();
  const { child, state } = startChild(command, args, {
    ...env,
    PORT: String(port),
  });

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline && !state.readyAt) await sleep(100);

  if (!state.readyAt) {
    console.log(`cold start      : TIMEOUT (>${maxWaitMs}ms)`);
    console.log(state.output.split("\n").slice(-6).join("\n"));
    child.kill("SIGKILL");
    return;
  }

  console.log(`cold start      : ${state.readyAt - startedAt}ms`);
  const shell = await timedFetch(`http://127.0.0.1:${port}/`);
  console.log(
    `GET / (shell)   : ${shell.ms.toFixed(0)}ms, ${(shell.bytes / 1024).toFixed(0)} KB html [${shell.status}]`
  );
  const api = await timedFetch(
    `http://127.0.0.1:${port}/api/trpc/godmode.chat.list?input=%7B%7D`
  );
  console.log(`API round trip  : ${api.ms.toFixed(0)}ms [${api.status}]`);

  child.kill("SIGKILL");
  await sleep(500);
}

const baseEnv = {
  DATABASE_URL: "mysql://root:root@127.0.0.1:3306/godmode_ai",
  JWT_SECRET: "bench-only-not-a-real-secret",
  GODMODE_LOCAL_MODE: "true",
};

await measure({
  name: "dev (tsx + vite middleware)",
  command: "node",
  args: ["node_modules/tsx/dist/cli.mjs", "server/_core/index.ts"],
  env: { ...baseEnv, NODE_ENV: "development" },
  port: 3201,
  maxWaitMs: 45_000,
});

await measure({
  name: "prod (bundled node)",
  command: "node",
  args: ["dist/index.js"],
  env: { ...baseEnv, NODE_ENV: "production" },
  port: 3202,
  maxWaitMs: 30_000,
});

console.log("\ndone");
process.exit(0);
