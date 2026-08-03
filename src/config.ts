import type { Env } from "./types.js";
import { AllowedEmailsError, parseAllowedEmailsStrict } from "./auth/allowedEmails.js";
import { loadAccessConfig, AccessAuthError, normalizeTeamDomain } from "./auth/cloudflareAccess.js";

export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_PRESENCE_GAP_MINUTES = 20;
export const DEFAULT_MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REASONABLE_BODY_BYTES = 25 * 1024 * 1024;
export const MIN_REASONABLE_BODY_BYTES = 64;
export const MAX_GAP_MINUTES = 24 * 60;

export interface ParsedAppConfig {
  timezone: string;
  webhookSecret: string | null;
  allowInsecureWebhooks: boolean;
  maxWebhookBodyBytes: number;
  enableVehicleEvents: boolean;
  allowLocalAuthBypass: boolean;
  accessTeamDomain: string | null;
  accessAud: string | null;
  allowedEmails: string[];
  allowlistDuplicatesFound: boolean;
  honeybadgerApiKey: string | null;
  presenceGapMinutes: number;
  presenceGapByPerson: Record<string, number>;
  presenceGapByCamera: Record<string, number>;
  targetPersonNames: string[];
  targetPersonIds: string[];
  watchCameraIds: string[];
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

  let allowedEmails: string[] = [];
  let allowlistDuplicatesFound = false;
  try {
    const parsed = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
    allowedEmails = parsed.emails;
    allowlistDuplicatesFound = parsed.duplicatesFound;
  } catch (err) {
    if (err instanceof AllowedEmailsError) {
      errors.push(err.message);
    } else {
      errors.push("ALLOWED_EMAILS is invalid.");
    }
  }

  let accessTeamDomain: string | null = null;
  try {
    accessTeamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  } catch (err) {
    if (requireSecure) {
      errors.push(err instanceof Error ? err.message : "CF_ACCESS_TEAM_DOMAIN is invalid.");
    }
  }

  const accessAud = env.CF_ACCESS_AUD?.trim() || null;
  if (requireSecure && !accessAud) {
    errors.push("CF_ACCESS_AUD is required.");
  }

  const allowLocalAuthBypass = env.ALLOW_LOCAL_AUTH_BYPASS?.trim().toLowerCase() === "true";

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
    allowLocalAuthBypass,
    accessTeamDomain,
    accessAud,
    allowedEmails,
    allowlistDuplicatesFound,
    honeybadgerApiKey: env.HONEYBADGER_API_KEY?.trim() || null,
    presenceGapMinutes,
    presenceGapByPerson,
    presenceGapByCamera,
    targetPersonNames: parseCsvLower(env.TARGET_PERSON_NAMES),
    targetPersonIds: parseCsvLower(env.TARGET_PERSON_IDS),
    watchCameraIds: parseCsvLower(env.WATCH_CAMERA_IDS),
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

  try {
    const parsed = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
    if (parsed.duplicatesFound) {
      warnings.push(
        "ALLOWED_EMAILS contains duplicate entries after normalization; clean up advised."
      );
    }
  } catch {
    // already reported via parseAppConfig
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
  if (env.ALLOW_LOCAL_AUTH_BYPASS?.trim().toLowerCase() === "true") {
    warnings.push(
      "ALLOW_LOCAL_AUTH_BYPASS=true — dashboard Access JWT checks are bypassed on localhost only."
    );
  }

  try {
    loadAccessConfig(env);
  } catch (err) {
    if (err instanceof AccessAuthError) {
      warnings.push(`Cloudflare Access configuration: ${err.failureClass}`);
    }
  }

  return [...new Set(warnings)];
}

export function accessHealthSummary(env: Env): {
  configured: boolean;
  allowlist_count: number;
} {
  try {
    const cfg = loadAccessConfig(env);
    return { configured: true, allowlist_count: cfg.allowedEmails.length };
  } catch {
    try {
      const { count } = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
      return { configured: false, allowlist_count: count };
    } catch {
      return { configured: false, allowlist_count: 0 };
    }
  }
}
