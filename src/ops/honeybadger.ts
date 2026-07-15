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

/**
 * Report a server-side failure to Honeybadger without blocking the response.
 * No-ops when HONEYBADGER_API_KEY is unset.
 */
export function reportError(
  env: Env,
  ctx: ExecutionContext,
  error: unknown,
  context?: { component?: string; path?: string }
): void {
  if (!ensureConfigured(env)) return;

  const noticeable = error instanceof Error ? error : new Error(String(error));
  if (context?.component || context?.path) {
    Honeybadger.setContext({
      ...(context.component ? { component: context.component } : {}),
      ...(context.path ? { path: context.path } : {}),
    });
  }

  ctx.waitUntil(
    Honeybadger.notifyAsync(noticeable).catch((notifyErr) => {
      console.error("[honeybadger] notify failed:", notifyErr);
    })
  );
}
