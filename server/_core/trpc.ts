import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

/**
 * Drizzle prefixes every failed statement with "Failed query:" and appends the
 * bound parameters, which can expose row values (including encrypted provider
 * key ciphertext). Those messages are replaced with operator guidance; the full
 * detail stays in the server log. Deliberately user-facing service messages —
 * free-model recovery, quota exhaustion, validation guidance — are preserved.
 */
const DATABASE_ERROR_PATTERN = /^\s*failed query:/i;
const DATABASE_ERROR_MESSAGE =
  "The database request failed. Confirm your MySQL/TiDB server is running and that DATABASE_URL points at a migrated database, then retry.";

export function redactDatabaseError(message: string): string {
  return DATABASE_ERROR_PATTERN.test(message)
    ? DATABASE_ERROR_MESSAGE
    : message;
}

/**
 * Exported as a standalone function so the redaction contract is unit-testable.
 * Only database internals are rewritten; every other message reaches the browser
 * exactly as the service authored it.
 */
export function formatError<
  S extends { data: object },
  E extends { message: string },
>({ shape, error }: { shape: S; error: E }) {
  return {
    ...shape,
    message: redactDatabaseError(error.message),
    data: {
      ...shape.data,
      // Stack traces are a server-side diagnostic only.
      stack: undefined,
    },
  };
}

export const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: formatError,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
