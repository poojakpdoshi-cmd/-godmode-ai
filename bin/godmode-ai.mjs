#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "dev";
const envFile = join(root, ".env");
const envExample = join(root, "local.env.template");
const require = createRequire(import.meta.url);
const { config } = require("dotenv");
if (existsSync(envFile)) config({ path: envFile });

const requiredForLocalRun = ["DATABASE_URL", "JWT_SECRET"];
function missingLocalValues() {
  return requiredForLocalRun.filter(key => !process.env[key] || /replace-with|change-me/i.test(process.env[key]));
}

function printUsage() {
  console.log("GODMODE AI local CLI\n\nCommands:\n  godmode-ai init       Create a local .env from .env.example\n  godmode-ai doctor     Validate local prerequisites\n  godmode-ai db         Apply local database migrations\n  godmode-ai dev        Start loopback-only local app and open http://127.0.0.1:3000\n");
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function runPnpm(args, extraEnv = {}, openUrl) {
  const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, { cwd: root, stdio: openUrl ? ["ignore", "pipe", "pipe"] : "inherit", env: { ...process.env, ...extraEnv } });
  if (openUrl && child.stdout && child.stderr) {
    let opened = false;
    const relay = chunk => {
      process.stdout.write(chunk);
      if (!opened && String(chunk).includes("Server running on")) { opened = true; openBrowser(openUrl); }
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", chunk => process.stderr.write(chunk));
  }
  child.on("exit", code => process.exit(code ?? 1));
}

if (command === "init") {
  if (existsSync(envFile)) console.log(".env already exists; no values were changed.");
  else { copyFileSync(envExample, envFile); console.log("Created .env. Add your DATABASE_URL and a long JWT_SECRET, then run: godmode-ai db && godmode-ai dev"); }
} else if (command === "doctor") {
  const missing = missingLocalValues();
  console.log(`Node ${process.versions.node}`);
  console.log(existsSync(join(root, "node_modules")) ? "Dependencies: installed" : "Dependencies: missing — run pnpm install");
  console.log(missing.length ? `Local environment: missing ${missing.join(", ")}` : "Local environment: ready");
  console.log("Provider keys are entered in the local browser and encrypted with JWT_SECRET. The local server binds to 127.0.0.1 only.");
  process.exit(missing.length ? 1 : 0);
} else if (command === "db") {
  runPnpm(["db:push"]);
} else if (command === "dev") {
  const missing = missingLocalValues();
  if (missing.length) { console.error(`Missing ${missing.join(", ")}. Run godmode-ai init and fill .env first.`); process.exit(1); }
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}`;
  console.log(`Starting GODMODE locally at ${url} (loopback only)…`);
  runPnpm(["dev"], { GODMODE_LOCAL_MODE: "true" }, url);
} else {
  printUsage();
  process.exit(command === "help" || command === "--help" ? 0 : 1);
}
