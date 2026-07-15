import type { Env } from "../types.js";
import { parseAllowedEmails } from "../auth-allowlist.js";

/**
 * Surface misconfiguration that would break ingest, auth, or sessionization.
 */
export function getConfigWarnings(env: Env): string[] {
  const warnings: string[] = [];

  if (!env.WEBHOOK_SECRET?.trim()) {
    warnings.push("WEBHOOK_SECRET is unset — POST /unifi accepts requests without authentication.");
  }

  if (parseAllowedEmails(env.ALLOWED_EMAILS).size === 0) {
    warnings.push("ALLOWED_EMAILS is empty — no Google accounts can sign in to the dashboard.");
  }

  if (!env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()) {
    warnings.push("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — Google sign-in will fail.");
  }

  if (!env.BETTER_AUTH_SECRET?.trim()) {
    warnings.push("BETTER_AUTH_SECRET missing — session signing is insecure or will fail in production.");
  }

  if (!env.BETTER_AUTH_API_KEY?.trim()) {
    warnings.push("BETTER_AUTH_API_KEY missing — Better Auth Infrastructure (dash) will not connect.");
  }

  if (!env.HONEYBADGER_API_KEY?.trim()) {
    warnings.push("HONEYBADGER_API_KEY missing — server errors will not be reported to Honeybadger.");
  }

  for (const [label, raw] of [
    ["PRESENCE_GAP_BY_PERSON", env.PRESENCE_GAP_BY_PERSON],
    ["PRESENCE_GAP_BY_CAMERA", env.PRESENCE_GAP_BY_CAMERA],
  ] as const) {
    if (raw?.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          warnings.push(`${label} must be a JSON object of string keys to numbers.`);
        }
      } catch {
        warnings.push(`${label} is not valid JSON.`);
      }
    }
  }

  return warnings;
}
