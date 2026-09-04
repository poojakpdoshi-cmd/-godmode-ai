import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { formatError, redactDatabaseError } from "./_core/trpc";

/**
 * Drizzle reports failed statements as "Failed query: <sql>\nparams: <values>",
 * which leaks table shapes and bound row values to the browser. The app relies
 * on plain Error messages for operator guidance (free-model recovery, quota
 * exhaustion, validation help), so sanitization must be narrow, not blanket.
 */
describe("tRPC error sanitization", () => {
  const drizzleFailure =
    "Failed query: select `id`, `openId` from `users` where `users`.`openId` = ? limit ?\nparams: godmode-local-operator,1";

  it("redacts raw SQL and bound parameters from database failures", () => {
    const result = redactDatabaseError(drizzleFailure);

    expect(result).not.toContain("select");
    expect(result).not.toContain("params");
    expect(result).not.toContain("godmode-local-operator");
    expect(result).toMatch(/database request failed/i);
  });

  it("preserves deliberately user-facing service recovery messages", () => {
    const guidance =
      "This historical response used a paid or retired OpenRouter model. Choose a current free model from Model Routing and resend the prompt instead of retrying this model.";

    expect(redactDatabaseError(guidance)).toBe(guidance);
  });

  it("preserves explicit TRPCError messages and codes", () => {
    const error = new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid chat selection.",
    });
    const shape = {
      message: error.message,
      code: -32600,
      data: { code: "BAD_REQUEST", httpStatus: 400 },
    };

    const formatted = formatError({ shape, error });

    expect(formatted.message).toBe("Invalid chat selection.");
    expect(formatted.data.code).toBe("BAD_REQUEST");
  });

  it("strips stack traces from the client payload", () => {
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: drizzleFailure,
    });
    const shape = {
      message: drizzleFailure,
      code: -32603,
      data: {
        code: "INTERNAL_SERVER_ERROR",
        httpStatus: 500,
        stack: "Error: Failed query: …\n at MySql2PreparedQuery",
      },
    };

    const formatted = formatError({ shape, error });
    const serialized = JSON.stringify(formatted);

    expect(formatted.data.stack).toBeUndefined();
    expect(serialized).not.toContain("MySql2PreparedQuery");
    expect(serialized).not.toContain("godmode-local-operator");
  });
});
