import Honeybadger from "@honeybadger-io/js";
import type { Env } from "../types.js";

function ensureConfigured(env: Env): boolean {
  const apiKey = env.HONEYBADGER_API_KEY?.trim();
  if (!apiKey) return false;
  if (Honeybadger.config.apiKey !== apiKey) {
    Honeybadger.configure({
      apiKey,
      environment: "production",
    });
  }
  return true;
}

export type ErrorContext = {
  component?: string;
  path?: string;
  request_id?: string;
  operation?: string;
  error_code?: string;
};

/**
 * Report a server-side failure to Honeybadger without blocking the response.
 * Context is passed per-notify (request-scoped) — never via global setContext —
 * so concurrent requests cannot leak context into each other.
 * Callers must not put biometric payloads, plates, secrets, or raw SQL in context.
 */
export function reportError(
  env: Env,
  ctx: ExecutionContext,
  error: unknown,
  context?: ErrorContext
): void {
  if (!ensureConfigured(env)) return;

  const noticeable = error instanceof Error ? error : new Error(String(error));
  // Strip potentially sensitive message content from notice metadata; keep error name/code only.
  const safeContext: Record<string, string> = {};
  if (context?.component) safeContext.component = context.component;
  if (context?.path) safeContext.path = context.path;
  if (context?.request_id) safeContext.request_id = context.request_id;
  if (context?.operation) safeContext.operation = context.operation;
  if (context?.error_code) safeContext.error_code = context.error_code;

  ctx.waitUntil(
    Honeybadger.notifyAsync(noticeable, {
      context: safeContext,
    }).catch((notifyErr) => {
      console.error("[honeybadger] notify failed:", notifyErr);
    })
  );
}
