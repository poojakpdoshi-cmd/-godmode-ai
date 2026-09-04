/**
 * Measures the app-side request payload controls in server/chatService.ts.
 * This is the only latency the application owns; everything else is upstream
 * provider time. Not part of the test suite — run with:
 *   pnpm exec tsx bench/payload-bench.ts
 */
import {
  buildProviderMessages,
  compileExecutionPolicy,
} from "../server/chatService";

const CHARS_PER_TOKEN = 4; // rough OpenAI-style heuristic

function payloadChars(messages: { role: string; content: string }[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function tokens(chars: number) {
  return Math.round(chars / CHARS_PER_TOKEN);
}

// A realistic worst case: the max system prompt the API accepts is 60,000 chars.
const largeSystemPrompt = "You are GODMODE. ".repeat(60_000 / 17);

// A long-running conversation: 40 completed turns of dense prose.
const longHistory = Array.from({ length: 40 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `Turn ${index + 1}: ${"explain the tradeoffs in detail ".repeat(45)}`,
  status: "completed",
}));

console.log("=== System prompt compilation (fast mode) ===");
const compiled = compileExecutionPolicy(largeSystemPrompt, true) ?? "";
console.log(
  `saved prompt  : ${largeSystemPrompt.length.toLocaleString()} chars (~${tokens(largeSystemPrompt.length).toLocaleString()} tokens)`
);
console.log(
  `sent upstream : ${compiled.length.toLocaleString()} chars (~${tokens(compiled.length).toLocaleString()} tokens)`
);
console.log(
  `reduction     : ${(100 - (compiled.length / largeSystemPrompt.length) * 100).toFixed(1)}%`
);

console.log("\n=== Conversation history bounding ===");
const fastMessages = buildProviderMessages(
  largeSystemPrompt,
  longHistory,
  true
);
const fullMessages = buildProviderMessages(
  largeSystemPrompt,
  longHistory,
  false
);
console.log(
  `history supplied : ${payloadChars(longHistory).toLocaleString()} chars across ${longHistory.length} turns`
);
console.log(
  `fast mode sends  : ${payloadChars(fastMessages).toLocaleString()} chars (~${tokens(payloadChars(fastMessages)).toLocaleString()} tokens) in ${fastMessages.length} messages`
);
console.log(
  `full mode sends  : ${payloadChars(fullMessages).toLocaleString()} chars (~${tokens(payloadChars(fullMessages)).toLocaleString()} tokens) in ${fullMessages.length} messages`
);
console.log(
  `fast vs full     : ${(100 - (payloadChars(fastMessages) / payloadChars(fullMessages)) * 100).toFixed(1)}% smaller`
);

console.log("\n=== App-side processing cost per request ===");
const iterations = 2_000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  buildProviderMessages(largeSystemPrompt, longHistory, true);
}
const elapsedMs = performance.now() - start;
const perCallMs = elapsedMs / iterations;
console.log(
  `${iterations.toLocaleString()} builds in ${elapsedMs.toFixed(1)}ms`
);
console.log(
  `per request    : ${(perCallMs * 1000).toFixed(1)}µs (${perCallMs.toFixed(4)}ms)`
);

const upstreamBudgetMs = 3_000; // a fast free-model round trip is ~1-5s
console.log(
  `share of a ${upstreamBudgetMs}ms round trip: ${((perCallMs / upstreamBudgetMs) * 100).toFixed(4)}%`
);
