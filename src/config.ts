import type { Env } from "./types.js";
import { parseAllowedEmails } from "./auth-allowlist.js";

export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_PRESENCE_GAP_MINUTES = 20;
export const DEFAULT_MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;
export const MAX_REASONABLE_BODY_BYTES = 25 * 1024 * 1024;
export const MIN_REASONABLE_BODY_BYTES = 64;
export const MAX_GAP_MINUTES = 24 * 60;

export interface ParsedAppConfig {
  timezone: string;
  webhookSecret: string | null;
  allowInsecureWebhooks: boolean;
  maxWebhookBodyBytes: number;
  enableVehicleEvents: boolean;
  betterAuthUrl: string | null;
  betterAuthSecret: string | null;
  betterAuthApiKey: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  allowedEmails: Set<string>;
  honeybadgerApiKey: string | null;
  presenceGapMinutes: number;
  presenceGapByPerson: Record<string, number>;
  presenceGapByCamera: Record<string, number>;
  targetPersonNames: string[];
  targetPersonIds: string[];
  watchCameraIds: string[];
  isLocalDev: boolean;
}

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_INVALID";
  constructor(
    message: string,
    readonly details: string[] = []
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function isRecognizedTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parsePositiveNumberMap(
  raw: string | undefined,
  label: string,
  errors: string[]
): Record<string, number> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(`${label} must be a JSON object of string keys to positive numbers.`);
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > MAX_GAP_MINUTES
      ) {
        errors.push(`${label}["${key}"] must be a finite positive number ≤ ${MAX_GAP_MINUTES}.`);
        continue;
      }
      out[key] = value;
    }
    return out;
  } catch {
    errors.push(`${label} is not valid JSON.`);
    return {};
  }
}

function parseCsvLower(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseAbsoluteUrl(raw: string | undefined, label: string, errors: string[]): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${label} must be an http(s) URL.`);
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    errors.push(`${label} is not a valid absolute URL.`);
    return null;
  }
}

/**
 * Parse and validate Worker env into a typed config.
 * Fail-closed for settings required for secure operation unless explicitly opted out.
 */
export function parseAppConfig(env: Env, options?: { requireSecure?: boolean }): ParsedAppConfig {
  const errors: string[] = [];
  const requireSecure = options?.requireSecure ?? true;

  const timezone = (env.TIMEZONE || DEFAULT_TIMEZONE).trim();
  if (!isRecognizedTimeZone(timezone)) {
    errors.push(`TIMEZONE "${timezone}" is not a recognized IANA time zone.`);
  }

  const allowInsecureWebhooks = env.ALLOW_INSECURE_WEBHOOKS?.trim().toLowerCase() === "true";
  const webhookSecret = env.WEBHOOK_SECRET?.trim() || null;
  if (!webhookSecret && !allowInsecureWebhooks) {
    errors.push(
      "WEBHOOK_SECRET is required unless ALLOW_INSECURE_WEBHOOKS=true (local insecure mode only)."
    );
  }

  let maxWebhookBodyBytes = DEFAULT_MAX_WEBHOOK_BODY_BYTES;
  if (env.MAX_WEBHOOK_BODY_BYTES?.trim()) {
    const n = Number(env.MAX_WEBHOOK_BODY_BYTES);
    if (!Number.isFinite(n) || n < MIN_REASONABLE_BODY_BYTES || n > MAX_REASONABLE_BODY_BYTES) {
      errors.push(
        `MAX_WEBHOOK_BODY_BYTES must be a finite number between ${MIN_REASONABLE_BODY_BYTES} and ${MAX_REASONABLE_BODY_BYTES}.`
      );
    } else {
      maxWebhookBodyBytes = Math.floor(n);
    }
  }

  const betterAuthUrl = parseAbsoluteUrl(env.BETTER_AUTH_URL, "BETTER_AUTH_URL", errors);
  const isLocalDev =
    !!betterAuthUrl &&
    (betterAuthUrl.startsWith("http://localhost") || betterAuthUrl.startsWith("http://127.0.0.1"));

  if (betterAuthUrl && !isLocalDev && !betterAuthUrl.startsWith("https://")) {
    errors.push("BETTER_AUTH_URL must use HTTPS outside local development.");
  }

  const betterAuthSecret = env.BETTER_AUTH_SECRET?.trim() || null;
  if (
    requireSecure &&
    (!betterAuthSecret || betterAuthSecret.length < MIN_BETTER_AUTH_SECRET_LENGTH)
  ) {
    errors.push(
      `BETTER_AUTH_SECRET must be set and at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters.`
    );
  }

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || null;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || null;
  if ((googleClientId && !googleClientSecret) || (!googleClientId && googleClientSecret)) {
    errors.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.");
  }

  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS);
  if (requireSecure && !isLocalDev && allowedEmails.size === 0) {
    errors.push("ALLOWED_EMAILS must be non-empty in production.");
  }

  let presenceGapMinutes = DEFAULT_PRESENCE_GAP_MINUTES;
  if (env.PRESENCE_GAP_MINUTES?.trim()) {
    const n = Number(env.PRESENCE_GAP_MINUTES);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_GAP_MINUTES) {
      errors.push(`PRESENCE_GAP_MINUTES must be a finite positive number ≤ ${MAX_GAP_MINUTES}.`);
    } else {
      presenceGapMinutes = n;
    }
  }

  const presenceGapByPerson = parsePositiveNumberMap(
    env.PRESENCE_GAP_BY_PERSON,
    "PRESENCE_GAP_BY_PERSON",
    errors
  );
  const presenceGapByCamera = parsePositiveNumberMap(
    env.PRESENCE_GAP_BY_CAMERA,
    "PRESENCE_GAP_BY_CAMERA",
    errors
  );

  if (errors.length > 0 && requireSecure) {
    throw new ConfigValidationError("Invalid application configuration", errors);
  }

  return {
    timezone: isRecognizedTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE,
    webhookSecret,
    allowInsecureWebhooks,
    maxWebhookBodyBytes,
    enableVehicleEvents: env.ENABLE_VEHICLE_EVENTS?.trim().toLowerCase() === "true",
    betterAuthUrl,
    betterAuthSecret,
    betterAuthApiKey: env.BETTER_AUTH_API_KEY?.trim() || null,
    googleClientId,
    googleClientSecret,
    allowedEmails,
    honeybadgerApiKey: env.HONEYBADGER_API_KEY?.trim() || null,
    presenceGapMinutes,
    presenceGapByPerson,
    presenceGapByCamera,
    targetPersonNames: parseCsvLower(env.TARGET_PERSON_NAMES),
    targetPersonIds: parseCsvLower(env.TARGET_PERSON_IDS),
    watchCameraIds: parseCsvLower(env.WATCH_CAMERA_IDS),
    isLocalDev,
  };
}

/** Soft warnings for /health — supplements fail-closed validation. */
export function collectConfigWarnings(env: Env): string[] {
  const warnings: string[] = [];
  try {
    parseAppConfig(env, { requireSecure: true });
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      warnings.push(...err.details);
    } else {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!env.BETTER_AUTH_URL?.trim()) {
    warnings.push("BETTER_AUTH_URL missing — auth base URL cannot be resolved.");
  }

  if (!env.BETTER_AUTH_API_KEY?.trim()) {
    warnings.push(
      "BETTER_AUTH_API_KEY missing — Better Auth Infrastructure (dash) will not connect."
    );
  }
  if (!env.HONEYBADGER_API_KEY?.trim()) {
    warnings.push(
      "HONEYBADGER_API_KEY missing — server errors will not be reported to Honeybadger."
    );
  }
  if (env.ALLOW_INSECURE_WEBHOOKS?.trim().toLowerCase() === "true") {
    warnings.push(
      "ALLOW_INSECURE_WEBHOOKS=true — webhook authentication is disabled (local insecure mode)."
    );
  }

  return [...new Set(warnings)];
}
