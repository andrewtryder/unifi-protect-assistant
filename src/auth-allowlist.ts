import type { Env } from "./types.js";

export function parseAllowedEmails(raw?: string): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isEmailAllowed(email: string | undefined | null, env: Env): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);
  if (allowed.size === 0) return false;
  return allowed.has(email.trim().toLowerCase());
}
