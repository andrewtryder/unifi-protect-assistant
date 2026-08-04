#!/usr/bin/env node
/**
 * Idempotent Cloudflare Access provisioning for UniFi Protect Assistant.
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   (never printed)
 *   CLOUDFLARE_ACCOUNT_ID
 *   ALLOWED_EMAILS         (never print full list — count only)
 *   CF_ACCESS_TEAM_DOMAIN  (optional; default discover from org auth_domain)
 *   WORKER_NAME            (optional; default unifi-protect-assistant)
 *   WORKER_HOSTNAME        (optional; default unifi-protect-assistant.mrcoffee.workers.dev)
 *
 * Flags:
 *   --dry-run              print planned actions without mutating
 *
 * Webhook bypass note: Access "bypass" disables Access auth/logging for the
 * /unifi path only. Worker X-Webhook-Secret remains mandatory.
 */

import { parseAllowedEmailsStrict } from "../shared/allowedEmails.mjs";

export const DASHBOARD_APP_NAME = "UniFi Protect Assistant";
export const DASHBOARD_POLICY_NAME = "Allowed Application Users";
export const WEBHOOK_APP_NAME = "UniFi Protect Assistant Webhook Bypass";
export const WEBHOOK_POLICY_NAME = "Webhook Path Bypass";
export const READY_APP_NAME = "UniFi Protect Assistant Ready Bypass";
export const READY_POLICY_NAME = "Ready Path Bypass";
export const WORKER_SCRIPT_NAME = "unifi-protect-assistant";
export const SESSION = "24h";
export const API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(message, { status, errors, url } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.errors = errors;
    this.url = url;
    this.isPermissionError = status === 403;
  }
}

export class ConfigureAccessError extends Error {
  constructor(message, code = "CONFIGURE_ACCESS_FAILED") {
    super(message);
    this.name = "ConfigureAccessError";
    this.code = code;
  }
}

/** @param {string[]} argv */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg === "--dry-run") flags.add("dryRun");
    else if (arg === "--help" || arg === "-h") flags.add("help");
    else throw new ConfigureAccessError(`Unknown argument: ${arg}`, "BAD_ARGS");
  }
  return {
    dryRun: flags.has("dryRun"),
    help: flags.has("help"),
  };
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function loadConfigFromEnv(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token) {
    throw new ConfigureAccessError("CLOUDFLARE_API_TOKEN is required", "MISSING_TOKEN");
  }
  if (!accountId) {
    throw new ConfigureAccessError("CLOUDFLARE_ACCOUNT_ID is required", "MISSING_ACCOUNT");
  }

  const parsed = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
  const workerName = (env.WORKER_NAME?.trim() || WORKER_SCRIPT_NAME).trim();
  const workerHostname = (
    env.WORKER_HOSTNAME?.trim() || `${WORKER_SCRIPT_NAME}.mrcoffee.workers.dev`
  )
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const teamDomainOverride = env.CF_ACCESS_TEAM_DOMAIN?.trim() || null;

  return {
    token,
    accountId,
    emails: parsed.emails,
    allowlistCount: parsed.count,
    duplicatesFound: parsed.duplicatesFound,
    workerName,
    workerHostname,
    teamDomainOverride,
    webhookUri: `${workerHostname}/unifi`,
    readyUri: `${workerHostname}/ready`,
  };
}

/** @param {string[]} emails */
export function buildDashboardPolicyInclude(emails) {
  return emails.map((email) => ({ email: { email } }));
}

/**
 * @param {string} hostname workers.dev hostname without scheme/path
 * @param {string[]} emails
 * @param {{ auto_redirect_to_identity: boolean, allowed_idps?: string[] }} [identity]
 */
export function buildDashboardAppBody(
  hostname,
  emails,
  identity = { auto_redirect_to_identity: false }
) {
  const host = normalizePublicUri(hostname);
  /** @type {Record<string, unknown>} */
  const body = {
    name: DASHBOARD_APP_NAME,
    type: "self_hosted",
    domain: host,
    session_duration: SESSION,
    auto_redirect_to_identity: identity.auto_redirect_to_identity === true,
    app_launcher_visible: false,
    destinations: [{ type: "public", uri: host }],
    policies: [
      {
        name: DASHBOARD_POLICY_NAME,
        decision: "allow",
        include: buildDashboardPolicyInclude(emails),
      },
    ],
  };
  if (identity.auto_redirect_to_identity && identity.allowed_idps?.length === 1) {
    body.allowed_idps = identity.allowed_idps;
  }
  return body;
}

/**
 * Instant auth IdP selection matching sunsethue-helper:
 * prefer Cloudflare, else One-time PIN. Do not prefer Google.
 * @param {unknown[]} idps
 */
export function resolveInstantAuthOptions(idps) {
  const list = (Array.isArray(idps) ? idps : []).filter(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof (/** @type {Record<string, unknown>} */ (p).id) === "string"
  );
  const cloudflareIdp = list.find(
    (p) => /** @type {Record<string, unknown>} */ (p).type === "cloudflare"
  );
  if (cloudflareIdp) {
    return {
      auto_redirect_to_identity: true,
      allowed_idps: [String(/** @type {Record<string, unknown>} */ (cloudflareIdp).id)],
    };
  }
  const otp = list.find((p) => /** @type {Record<string, unknown>} */ (p).type === "onetimepin");
  if (otp) {
    return {
      auto_redirect_to_identity: true,
      allowed_idps: [String(/** @type {Record<string, unknown>} */ (otp).id)],
    };
  }
  return { auto_redirect_to_identity: false };
}

/**
 * @param {string} name
 * @param {string} policyName
 * @param {string} publicUri hostname/path without scheme
 */
export function buildPathBypassAppBody(name, policyName, publicUri) {
  return {
    name,
    type: "self_hosted",
    session_duration: SESSION,
    app_launcher_visible: false,
    destinations: [{ type: "public", uri: publicUri }],
    policies: [
      {
        name: policyName,
        decision: "bypass",
        include: [{ everyone: {} }],
      },
    ],
  };
}

/**
 * @param {string} webhookUri hostname/path without scheme
 */
export function buildWebhookAppBody(webhookUri) {
  return buildPathBypassAppBody(WEBHOOK_APP_NAME, WEBHOOK_POLICY_NAME, webhookUri);
}

/**
 * @param {string} readyUri hostname/path without scheme
 */
export function buildReadyAppBody(readyUri) {
  return buildPathBypassAppBody(READY_APP_NAME, READY_POLICY_NAME, readyUri);
}

/** @param {unknown} include */
export function extractEmailsFromInclude(include) {
  if (!Array.isArray(include)) return [];
  const emails = [];
  for (const rule of include) {
    if (!rule || typeof rule !== "object") continue;
    const email = /** @type {Record<string, unknown>} */ (rule).email;
    if (email && typeof email === "object" && email !== null) {
      const value = /** @type {Record<string, unknown>} */ (email).email;
      if (typeof value === "string" && value.trim()) {
        emails.push(value.trim().toLowerCase());
      }
    }
  }
  return [...new Set(emails)].sort();
}

/** @param {unknown} include */
export function policyHasEmailDomain(include) {
  if (!Array.isArray(include)) return false;
  return include.some(
    (rule) => rule && typeof rule === "object" && "email_domain" in /** @type {object} */ (rule)
  );
}

/** @param {unknown} include */
export function policyHasEveryone(include) {
  if (!Array.isArray(include)) return false;
  return include.some(
    (rule) => rule && typeof rule === "object" && "everyone" in /** @type {object} */ (rule)
  );
}

/**
 * Fail if dashboard allow policy is not exactly the normalized email list
 * (email rules only — no email_domain / everyone).
 * @param {unknown} policy
 * @param {string[]} expectedEmails
 */
export function assertPolicyExactEmails(policy, expectedEmails) {
  if (!policy || typeof policy !== "object") {
    throw new ConfigureAccessError(
      "Dashboard policy missing after reconcile",
      "VERIFY_POLICY_MISSING"
    );
  }
  const p = /** @type {Record<string, unknown>} */ (policy);
  if (p.decision !== "allow") {
    throw new ConfigureAccessError(
      `Dashboard policy decision must be allow (got ${String(p.decision)})`,
      "VERIFY_POLICY_DECISION"
    );
  }
  if (policyHasEmailDomain(p.include)) {
    throw new ConfigureAccessError(
      "Dashboard policy must not include email_domain rules",
      "VERIFY_EMAIL_DOMAIN"
    );
  }
  if (policyHasEveryone(p.include)) {
    throw new ConfigureAccessError(
      "Dashboard policy must not include everyone allow",
      "VERIFY_EVERYONE"
    );
  }
  const actual = extractEmailsFromInclude(p.include);
  const expected = [...expectedEmails].map((e) => e.toLowerCase()).sort();
  if (!emailsEqual(actual, expected)) {
    throw new ConfigureAccessError(
      `Dashboard policy emails drifted (expected_count=${expected.length} actual_count=${actual.length})`,
      "VERIFY_EMAIL_DRIFT"
    );
  }
  // Ensure include contains only email rules
  if (Array.isArray(p.include)) {
    for (const rule of p.include) {
      if (!rule || typeof rule !== "object") {
        throw new ConfigureAccessError(
          "Dashboard policy include has invalid rule",
          "VERIFY_RULE_SHAPE"
        );
      }
      const keys = Object.keys(rule);
      if (keys.length !== 1 || keys[0] !== "email") {
        throw new ConfigureAccessError(
          "Dashboard policy include must be email rules only",
          "VERIFY_RULE_TYPE"
        );
      }
    }
  }
  return true;
}

/** @param {string[]} a @param {string[]} b */
export function emailsEqual(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].map((e) => e.toLowerCase()).sort();
  const right = [...b].map((e) => e.toLowerCase()).sort();
  return left.every((e, i) => e === right[i]);
}

/**
 * @param {unknown} destinations
 * @param {string} workerId
 */
export function workerDestinationMatches(destinations, workerId) {
  if (!Array.isArray(destinations)) return false;
  return destinations.some(
    (d) =>
      d &&
      typeof d === "object" &&
      /** @type {Record<string, unknown>} */ (d).type === "worker" &&
      /** @type {Record<string, unknown>} */ (d).worker_id === workerId
  );
}

/**
 * @param {unknown} destinations
 * @param {string} uri
 */
export function publicUriMatches(destinations, uri) {
  if (!Array.isArray(destinations)) return false;
  const want = normalizePublicUri(uri);
  return destinations.some((d) => {
    if (!d || typeof d !== "object") return false;
    const dest = /** @type {Record<string, unknown>} */ (d);
    return dest.type === "public" && normalizePublicUri(String(dest.uri ?? "")) === want;
  });
}

/** @param {string} uri */
export function normalizePublicUri(uri) {
  return String(uri || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * @param {string} actualUri
 * @param {string} expectedHostname
 */
export function assertWebhookPathExact(actualUri, expectedHostname) {
  const normalized = normalizePublicUri(actualUri);
  const expected = normalizePublicUri(`${expectedHostname}/unifi`);
  if (normalized !== expected) {
    throw new ConfigureAccessError(
      `Webhook bypass path must be exactly ${expected} (got ${normalized || "(empty)"})`,
      "VERIFY_WEBHOOK_PATH"
    );
  }
  const host = normalizePublicUri(expectedHostname);
  const pathPart = normalized.slice(host.length);
  if (pathPart !== "/unifi") {
    throw new ConfigureAccessError(
      "Webhook bypass path is overly broad or incorrect (must be /unifi only)",
      "VERIFY_WEBHOOK_BROAD"
    );
  }
  return true;
}

/**
 * @param {string} actualUri
 * @param {string} expectedHostname
 */
export function assertReadyPathExact(actualUri, expectedHostname) {
  const normalized = normalizePublicUri(actualUri);
  const expected = normalizePublicUri(`${expectedHostname}/ready`);
  if (normalized !== expected) {
    throw new ConfigureAccessError(
      `Ready bypass path must be exactly ${expected} (got ${normalized || "(empty)"})`,
      "VERIFY_READY_PATH"
    );
  }
  const host = normalizePublicUri(expectedHostname);
  if (normalized.slice(host.length) !== "/ready") {
    throw new ConfigureAccessError(
      "Ready bypass path is overly broad or incorrect (must be /ready only)",
      "VERIFY_READY_BROAD"
    );
  }
  return true;
}

/**
 * True when a managed dashboard policy has email_domain (or other non-email) allow rules.
 * @param {unknown} policy
 */
export function dashboardPolicyHasUnsafeRules(policy) {
  if (!policy || typeof policy !== "object") return false;
  const include = /** @type {Record<string, unknown>} */ (policy).include;
  if (policyHasEmailDomain(include) || policyHasEveryone(include)) return true;
  if (!Array.isArray(include)) return false;
  return include.some((rule) => {
    if (!rule || typeof rule !== "object") return true;
    const keys = Object.keys(rule);
    return keys.length !== 1 || keys[0] !== "email";
  });
}

/**
 * Find dashboard app by stable name + public hostname (sunsethue style).
 * Also accepts a legacy worker-destination app with this name so it can be migrated.
 * @param {unknown[]} apps
 * @param {string} hostname
 */
export function findDashboardApp(apps, hostname) {
  const host = normalizePublicUri(hostname);
  const named = (apps || []).filter(
    (a) =>
      a &&
      typeof a === "object" &&
      /** @type {Record<string, unknown>} */ (a).name === DASHBOARD_APP_NAME
  );
  if (named.length === 0) return null;

  const matchingPublic = named.filter((a) => {
    const app = /** @type {Record<string, unknown>} */ (a);
    if (publicUriMatches(app.destinations, host)) return true;
    if (typeof app.domain === "string" && normalizePublicUri(app.domain) === host) return true;
    return false;
  });
  if (matchingPublic.length === 1) return matchingPublic[0];
  if (matchingPublic.length > 1) {
    throw new ConfigureAccessError(
      `Multiple dashboard apps named "${DASHBOARD_APP_NAME}" with hostname match`,
      "AMBIGUOUS_DASHBOARD_APP"
    );
  }

  // Migrate legacy worker-destination app in place when it is the only named match.
  const legacyWorker = named.filter((a) => {
    const dest = /** @type {Record<string, unknown>} */ (a).destinations;
    if (!Array.isArray(dest)) return false;
    const hasWorker = dest.some(
      (d) => d && typeof d === "object" && /** @type {Record<string, unknown>} */ (d).type === "worker"
    );
    const hasPublic = dest.some(
      (d) => d && typeof d === "object" && /** @type {Record<string, unknown>} */ (d).type === "public"
    );
    return hasWorker && !hasPublic;
  });
  if (legacyWorker.length === 1 && named.length === 1) return legacyWorker[0];

  throw new ConfigureAccessError(
    `Access app "${DASHBOARD_APP_NAME}" exists but destination does not match hostname=${host}`,
    "DASHBOARD_NAME_DEST_CONFLICT"
  );
}

/**
 * @param {unknown[]} apps
 * @param {string} name
 * @param {string} publicUri
 * @param {string} conflictCode
 */
export function findPathBypassApp(apps, name, publicUri, conflictCode) {
  const named = (apps || []).filter(
    (a) => a && typeof a === "object" && /** @type {Record<string, unknown>} */ (a).name === name
  );
  if (named.length === 0) return null;

  const matching = named.filter((a) =>
    publicUriMatches(/** @type {Record<string, unknown>} */ (a).destinations, publicUri)
  );
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) {
    throw new ConfigureAccessError(
      `Multiple apps named "${name}" with matching uri`,
      "AMBIGUOUS_PATH_BYPASS_APP"
    );
  }
  throw new ConfigureAccessError(
    `Access app "${name}" exists but destination path is not exactly ${publicUri}`,
    conflictCode
  );
}

/**
 * @param {unknown[]} apps
 * @param {string} webhookUri
 */
export function findWebhookApp(apps, webhookUri) {
  return findPathBypassApp(apps, WEBHOOK_APP_NAME, webhookUri, "WEBHOOK_NAME_DEST_CONFLICT");
}

/**
 * @param {unknown[]} apps
 * @param {string} readyUri
 */
export function findReadyApp(apps, readyUri) {
  return findPathBypassApp(apps, READY_APP_NAME, readyUri, "READY_NAME_DEST_CONFLICT");
}

/**
 * Compare dashboard app settings (excluding policies).
 * @param {Record<string, unknown>} existing
 * @param {string} hostname
 * @param {{ auto_redirect_to_identity: boolean, allowed_idps?: string[] }} [identity]
 */
export function dashboardSettingsMatch(
  existing,
  hostname,
  identity = { auto_redirect_to_identity: false }
) {
  const wantRedirect = identity.auto_redirect_to_identity === true;
  const host = normalizePublicUri(hostname);
  const domainOk =
    typeof existing.domain === "string" ? normalizePublicUri(existing.domain) === host : true;
  if (
    existing.name !== DASHBOARD_APP_NAME ||
    existing.type !== "self_hosted" ||
    existing.session_duration !== SESSION ||
    existing.auto_redirect_to_identity !== wantRedirect ||
    existing.app_launcher_visible !== false ||
    !publicUriMatches(existing.destinations, host) ||
    !domainOk
  ) {
    return false;
  }
  if (wantRedirect && identity.allowed_idps?.length === 1) {
    const have = Array.isArray(existing.allowed_idps)
      ? existing.allowed_idps.map(String).sort()
      : [];
    const want = [...identity.allowed_idps].map(String).sort();
    return have.length === 1 && have[0] === want[0];
  }
  return true;
}

/**
 * @param {Record<string, unknown>} existing
 * @param {string} webhookUri
 */
export function webhookSettingsMatch(existing, webhookUri) {
  return (
    existing.name === WEBHOOK_APP_NAME &&
    existing.type === "self_hosted" &&
    existing.session_duration === SESSION &&
    existing.app_launcher_visible === false &&
    publicUriMatches(existing.destinations, webhookUri)
  );
}

/**
 * @param {Record<string, unknown>} existing
 * @param {string} readyUri
 */
export function readySettingsMatch(existing, readyUri) {
  return (
    existing.name === READY_APP_NAME &&
    existing.type === "self_hosted" &&
    existing.session_duration === SESSION &&
    existing.app_launcher_visible === false &&
    publicUriMatches(existing.destinations, readyUri)
  );
}

/**
 * @param {unknown[]} policies
 * @param {string} name
 */
export function findPolicyByName(policies, name) {
  return (
    (policies || []).find(
      (p) => p && typeof p === "object" && /** @type {Record<string, unknown>} */ (p).name === name
    ) || null
  );
}

/**
 * Redact secrets from strings for safe logging. Never leave tokens or emails.
 * @param {string} text
 * @param {{ token?: string, emails?: string[] }} secrets
 */
export function redactSensitive(text, secrets = {}) {
  let out = String(text ?? "");
  if (secrets.token) {
    out = out.split(secrets.token).join("[REDACTED_TOKEN]");
  }
  for (const email of secrets.emails || []) {
    if (!email) continue;
    const re = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, "[REDACTED_EMAIL]");
  }
  // Belt-and-suspenders: Authorization bearer values
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED_TOKEN]");
  return out;
}

/**
 * @param {(msg: string) => void} log
 * @param {{ token?: string, emails?: string[] }} secrets
 */
export function createSafeLogger(log = console.log, secrets = {}) {
  return (msg) => {
    log(redactSensitive(String(msg), secrets));
  };
}

/**
 * @param {{ token: string, accountId: string, fetchImpl?: typeof fetch }} opts
 */
export function createCfClient({ token, accountId, fetchImpl = fetch }) {
  const base = `${API_BASE}/accounts/${accountId}`;

  async function request(method, path, body) {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (res.status === 403) {
      throw new CloudflareApiError(
        "Cloudflare API returned 403 — token lacks Access Apps and Policies permissions (or Workers Read for script tag lookup)",
        { status: 403, errors: json?.errors, url }
      );
    }
    if (!res.ok || json?.success === false) {
      const detail =
        Array.isArray(json?.errors) && json.errors.length
          ? json.errors.map((e) => e.message || JSON.stringify(e)).join("; ")
          : `HTTP ${res.status}`;
      throw new CloudflareApiError(`Cloudflare API error: ${detail}`, {
        status: res.status,
        errors: json?.errors,
        url,
      });
    }
    return json?.result;
  }

  async function listAll(path) {
    const all = [];
    let page = 1;
    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${path}${sep}page=${page}&per_page=100`;
      const urlFull = `${base}${url}`;
      const res = await fetchImpl(urlFull, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status === 403) {
        throw new CloudflareApiError(
          "Cloudflare API returned 403 — token lacks required permissions",
          { status: 403, errors: json?.errors, url: urlFull }
        );
      }
      if (!res.ok || json?.success === false) {
        const detail =
          Array.isArray(json?.errors) && json.errors.length
            ? json.errors.map((e) => e.message || JSON.stringify(e)).join("; ")
            : `HTTP ${res.status}`;
        throw new CloudflareApiError(`Cloudflare API error: ${detail}`, {
          status: res.status,
          errors: json?.errors,
          url: urlFull,
        });
      }
      const batch = Array.isArray(json.result) ? json.result : [];
      all.push(...batch);
      const totalPages = json.result_info?.total_pages;
      if (!totalPages || page >= totalPages || batch.length === 0) break;
      page += 1;
    }
    return all;
  }

  return {
    getOrganization: () => request("GET", "/access/organizations"),
    listIdentityProviders: () => listAll("/access/identity_providers"),
    listWorkerScripts: () => listAll("/workers/scripts"),
    listAccessApps: () => listAll("/access/apps"),
    getAccessApp: (id) => request("GET", `/access/apps/${id}`),
    createAccessApp: (body) => request("POST", "/access/apps", body),
    updateAccessApp: (id, body) => request("PUT", `/access/apps/${id}`, body),
    listAppPolicies: (appId) => listAll(`/access/apps/${appId}/policies`),
    createAppPolicy: (appId, body) => request("POST", `/access/apps/${appId}/policies`, body),
    updateAppPolicy: (appId, policyId, body) =>
      request("PUT", `/access/apps/${appId}/policies/${policyId}`, body),
  };
}

/**
 * Resolve worker script tag (Access worker_id).
 * @param {unknown[]} scripts
 * @param {string} workerName
 */
export function resolveWorkerId(scripts, workerName) {
  const script = (scripts || []).find(
    (s) =>
      s &&
      typeof s === "object" &&
      /** @type {Record<string, unknown>} */ (
        s.id === workerName || /** @type {Record<string, unknown>} */ (s).name === workerName
      )
  );
  if (!script) {
    throw new ConfigureAccessError(
      `Worker script "${workerName}" not found in account`,
      "WORKER_NOT_FOUND"
    );
  }
  const tag = /** @type {Record<string, unknown>} */ (script).tag;
  if (typeof tag !== "string" || !tag) {
    throw new ConfigureAccessError(
      `Worker script "${workerName}" has no tag field for Access worker_id`,
      "WORKER_TAG_MISSING"
    );
  }
  return tag;
}

/**
 * @param {unknown} org
 * @param {string | null} override
 */
export function resolveTeamDomain(org, override) {
  if (override) {
    return override.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  const authDomain =
    org && typeof org === "object"
      ? /** @type {Record<string, unknown>} */ (org).auth_domain
      : null;
  if (typeof authDomain !== "string" || !authDomain.trim()) {
    throw new ConfigureAccessError(
      "Could not discover auth_domain from Access organization; set CF_ACCESS_TEAM_DOMAIN",
      "TEAM_DOMAIN_MISSING"
    );
  }
  return authDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * @param {Record<string, unknown> | null} policy
 * @param {string[]} emails
 */
export function dashboardPolicyNeedsUpdate(policy, emails) {
  if (!policy) return true;
  try {
    assertPolicyExactEmails(policy, emails);
    return false;
  } catch {
    return true;
  }
}

/**
 * @param {Record<string, unknown> | null} policy
 */
export function webhookPolicyNeedsUpdate(policy) {
  if (!policy) return true;
  if (policy.decision !== "bypass") return true;
  if (!policyHasEveryone(policy.include)) return true;
  // Bypass should be everyone-only
  if (!Array.isArray(policy.include) || policy.include.length !== 1) return true;
  return false;
}

/**
 * App body for PUT without policies (when policies are managed separately).
 * @param {ReturnType<typeof buildDashboardAppBody>} full
 */
export function appBodyWithoutPolicies(full) {
  const { policies: _policies, ...rest } = full;
  return rest;
}

/**
 * Orchestrate Access reconcile. Returns summary; throws on partial failure.
 *
 * @param {{
 *   config: ReturnType<typeof loadConfigFromEnv>,
 *   dryRun?: boolean,
 *   client?: ReturnType<typeof createCfClient>,
 *   log?: (msg: string) => void,
 * }} opts
 */
export async function configureAccess({ config, dryRun = false, client, log = console.log }) {
  const safeLog = createSafeLogger(log, {
    token: config.token,
    emails: config.emails,
  });
  const cf =
    client ||
    createCfClient({
      token: config.token,
      accountId: config.accountId,
    });

  const planned = [];
  let mutated = false;
  let failures = 0;

  safeLog(`allowlist_count=${config.allowlistCount}`);
  if (config.duplicatesFound) {
    safeLog("note: ALLOWED_EMAILS contained duplicates (normalized away)");
  }
  if (dryRun) safeLog("mode=dry-run (no mutations)");

  // 1–2. Org + hostname
  const org = await cf.getOrganization();
  const teamDomain = resolveTeamDomain(org, config.teamDomainOverride);
  safeLog(`team_domain=${teamDomain}`);
  safeLog(`worker_hostname=${config.workerHostname}`);

  // Worker script tag is diagnostic only (destination is public hostname).
  let workerId = null;
  try {
    const scripts = await cf.listWorkerScripts();
    workerId = resolveWorkerId(scripts, config.workerName);
    safeLog(`worker_id=${workerId}`);
  } catch (err) {
    safeLog(
      `note: worker script lookup skipped (${err instanceof Error ? err.message : "unavailable"})`
    );
  }

  const apps = await cf.listAccessApps();
  const idps =
    typeof cf.listIdentityProviders === "function" ? await cf.listIdentityProviders() : [];
  const identity = resolveInstantAuthOptions(idps);
  if (identity.auto_redirect_to_identity) {
    safeLog("identity: instant auth enabled for a single suitable IdP");
  } else {
    safeLog("identity: no Cloudflare/OTP IdP — instant auth disabled");
  }

  // --- Dashboard app ---
  let dashboardApp = null;
  let dashboardAud = null;
  try {
    const existing = findDashboardApp(apps, config.workerHostname);
    const desired = buildDashboardAppBody(config.workerHostname, config.emails, identity);

    if (!existing) {
      planned.push("create_dashboard_app");
      if (dryRun) {
        safeLog("plan: create dashboard Access app with email allow policy");
      } else {
        safeLog("action: create dashboard Access app");
        dashboardApp = await cf.createAccessApp(desired);
        mutated = true;
      }
    } else {
      dashboardApp = /** @type {Record<string, unknown>} */ (existing);
      const policies = await cf.listAppPolicies(String(dashboardApp.id));
      const namedPolicy = findPolicyByName(policies, DASHBOARD_POLICY_NAME);
      const allowPolicy =
        namedPolicy ||
        policies.find(
          (p) =>
            p &&
            typeof p === "object" &&
            /** @type {Record<string, unknown>} */ (p).decision === "allow"
        ) ||
        null;

      if (dashboardPolicyHasUnsafeRules(allowPolicy)) {
        safeLog(
          "warn: managed dashboard policy has email_domain/everyone/non-email rules — correcting"
        );
      }

      const settingsOk = dashboardSettingsMatch(dashboardApp, config.workerHostname, identity);
      const policyOk = !dashboardPolicyNeedsUpdate(
        /** @type {Record<string, unknown> | null} */ (allowPolicy),
        config.emails
      );

      if (settingsOk && policyOk) {
        safeLog("dashboard: no changes needed");
      } else {
        if (!settingsOk) {
          planned.push("update_dashboard_settings");
          if (dryRun) {
            safeLog("plan: update dashboard app settings");
          } else {
            safeLog("action: update dashboard app settings");
            dashboardApp = await cf.updateAccessApp(
              String(dashboardApp.id),
              appBodyWithoutPolicies(desired)
            );
            mutated = true;
          }
        }
        if (!policyOk) {
          planned.push("update_dashboard_policy");
          const policyBody = {
            name: DASHBOARD_POLICY_NAME,
            decision: "allow",
            include: buildDashboardPolicyInclude(config.emails),
          };
          if (dryRun) {
            safeLog(
              allowPolicy
                ? "plan: update dashboard policy include (allowlist drift correction)"
                : "plan: create dashboard allow policy"
            );
          } else if (allowPolicy && /** @type {Record<string, unknown>} */ (allowPolicy).id) {
            safeLog("action: update dashboard policy include");
            await cf.updateAppPolicy(
              String(dashboardApp.id),
              String(/** @type {Record<string, unknown>} */ (allowPolicy).id),
              policyBody
            );
            mutated = true;
          } else {
            safeLog("action: create/replace dashboard policies via app update");
            dashboardApp = await cf.updateAccessApp(String(dashboardApp.id), desired);
            mutated = true;
          }
        }
      }
    }

    if (!dryRun && dashboardApp?.id) {
      dashboardApp = await cf.getAccessApp(String(dashboardApp.id));
      const policies = await cf.listAppPolicies(String(dashboardApp.id));
      const policy =
        findPolicyByName(policies, DASHBOARD_POLICY_NAME) ||
        policies.find(
          (p) =>
            p &&
            typeof p === "object" &&
            /** @type {Record<string, unknown>} */ (p).decision === "allow"
        );
      assertPolicyExactEmails(policy, config.emails);
      dashboardAud =
        typeof dashboardApp.aud === "string"
          ? dashboardApp.aud
          : Array.isArray(dashboardApp.aud)
            ? dashboardApp.aud[0]
            : null;
      if (!dashboardAud) {
        throw new ConfigureAccessError("Dashboard app missing aud after reconcile", "MISSING_AUD");
      }
    } else if (dashboardApp?.aud) {
      dashboardAud =
        typeof dashboardApp.aud === "string"
          ? dashboardApp.aud
          : Array.isArray(dashboardApp.aud)
            ? dashboardApp.aud[0]
            : null;
    }
  } catch (err) {
    failures += 1;
    safeLog(`error: dashboard reconcile failed: ${err instanceof Error ? err.message : err}`);
    throw err;
  }

  // --- Webhook bypass app ---
  let webhookApp = null;
  try {
    safeLog(
      "note: Bypass disables Access auth/logging for /unifi only; Worker X-Webhook-Secret remains mandatory"
    );
    const existing = findWebhookApp(apps, config.webhookUri);
    const desired = buildWebhookAppBody(config.webhookUri);

    if (!existing) {
      planned.push("create_webhook_app");
      if (dryRun) {
        safeLog(`plan: create webhook bypass app for ${config.webhookUri}`);
      } else {
        safeLog("action: create webhook bypass Access app");
        webhookApp = await cf.createAccessApp(desired);
        mutated = true;
      }
    } else {
      webhookApp = /** @type {Record<string, unknown>} */ (existing);
      // Verify path not overly broad
      const dest = Array.isArray(webhookApp.destinations)
        ? webhookApp.destinations.find(
            (d) =>
              d &&
              typeof d === "object" &&
              /** @type {Record<string, unknown>} */ (d).type === "public"
          )
        : null;
      const uri =
        dest && typeof dest === "object"
          ? String(/** @type {Record<string, unknown>} */ (dest).uri ?? "")
          : "";
      assertWebhookPathExact(uri, config.workerHostname);

      const policies = await cf.listAppPolicies(String(webhookApp.id));
      const namedPolicy = findPolicyByName(policies, WEBHOOK_POLICY_NAME);
      const bypassPolicy =
        namedPolicy ||
        policies.find(
          (p) =>
            p &&
            typeof p === "object" &&
            /** @type {Record<string, unknown>} */ (p).decision === "bypass"
        ) ||
        null;

      const settingsOk = webhookSettingsMatch(webhookApp, config.webhookUri);
      const policyOk = !webhookPolicyNeedsUpdate(
        /** @type {Record<string, unknown> | null} */ (bypassPolicy)
      );

      if (settingsOk && policyOk) {
        safeLog("webhook: no changes needed");
      } else {
        if (!settingsOk) {
          planned.push("update_webhook_settings");
          if (dryRun) safeLog("plan: update webhook app settings");
          else {
            safeLog("action: update webhook app settings");
            webhookApp = await cf.updateAccessApp(
              String(webhookApp.id),
              appBodyWithoutPolicies(desired)
            );
            mutated = true;
          }
        }
        if (!policyOk) {
          planned.push("update_webhook_policy");
          const policyBody = {
            name: WEBHOOK_POLICY_NAME,
            decision: "bypass",
            include: [{ everyone: {} }],
          };
          if (dryRun) {
            safeLog("plan: update webhook bypass policy");
          } else if (bypassPolicy && /** @type {Record<string, unknown>} */ (bypassPolicy).id) {
            await cf.updateAppPolicy(
              String(webhookApp.id),
              String(/** @type {Record<string, unknown>} */ (bypassPolicy).id),
              policyBody
            );
            mutated = true;
          } else {
            webhookApp = await cf.updateAccessApp(String(webhookApp.id), desired);
            mutated = true;
          }
        }
      }
    }

    if (!dryRun && webhookApp?.id) {
      webhookApp = await cf.getAccessApp(String(webhookApp.id));
      const dest = Array.isArray(webhookApp.destinations)
        ? webhookApp.destinations.find(
            (d) =>
              d &&
              typeof d === "object" &&
              /** @type {Record<string, unknown>} */ (d).type === "public"
          )
        : null;
      const uri =
        dest && typeof dest === "object"
          ? String(/** @type {Record<string, unknown>} */ (dest).uri ?? "")
          : "";
      assertWebhookPathExact(uri, config.workerHostname);
    }
  } catch (err) {
    failures += 1;
    safeLog(`error: webhook reconcile failed: ${err instanceof Error ? err.message : err}`);
    throw err;
  }

  // --- Ready bypass app (public non-sensitive readiness probe) ---
  try {
    safeLog("note: Bypass for /ready only — endpoint returns no secrets, allowlist, or PII");
    // Refresh app list so creates above are visible on a cold first run's follow-ups.
    const appsNow = await cf.listAccessApps();
    const existing = findReadyApp(appsNow, config.readyUri);
    const desired = buildReadyAppBody(config.readyUri);

    if (!existing) {
      planned.push("create_ready_app");
      if (dryRun) {
        safeLog(`plan: create ready bypass app for ${config.readyUri}`);
      } else {
        safeLog("action: create ready bypass Access app");
        await cf.createAccessApp(desired);
        mutated = true;
      }
    } else {
      let readyApp = /** @type {Record<string, unknown>} */ (existing);
      const dest = Array.isArray(readyApp.destinations)
        ? readyApp.destinations.find(
            (d) =>
              d &&
              typeof d === "object" &&
              /** @type {Record<string, unknown>} */ (d).type === "public"
          )
        : null;
      const uri =
        dest && typeof dest === "object"
          ? String(/** @type {Record<string, unknown>} */ (dest).uri ?? "")
          : "";
      assertReadyPathExact(uri, config.workerHostname);

      const policies = await cf.listAppPolicies(String(readyApp.id));
      const namedPolicy = findPolicyByName(policies, READY_POLICY_NAME);
      const bypassPolicy =
        namedPolicy ||
        policies.find(
          (p) =>
            p &&
            typeof p === "object" &&
            /** @type {Record<string, unknown>} */ (p).decision === "bypass"
        ) ||
        null;

      const settingsOk = readySettingsMatch(readyApp, config.readyUri);
      const policyOk = !webhookPolicyNeedsUpdate(
        /** @type {Record<string, unknown> | null} */ (bypassPolicy)
      );

      if (settingsOk && policyOk) {
        safeLog("ready: no changes needed");
      } else {
        if (!settingsOk) {
          planned.push("update_ready_settings");
          if (dryRun) safeLog("plan: update ready app settings");
          else {
            safeLog("action: update ready app settings");
            readyApp = await cf.updateAccessApp(
              String(readyApp.id),
              appBodyWithoutPolicies(desired)
            );
            mutated = true;
          }
        }
        if (!policyOk) {
          planned.push("update_ready_policy");
          const policyBody = {
            name: READY_POLICY_NAME,
            decision: "bypass",
            include: [{ everyone: {} }],
          };
          if (dryRun) {
            safeLog("plan: update ready bypass policy");
          } else if (bypassPolicy && /** @type {Record<string, unknown>} */ (bypassPolicy).id) {
            await cf.updateAppPolicy(
              String(readyApp.id),
              String(/** @type {Record<string, unknown>} */ (bypassPolicy).id),
              policyBody
            );
            mutated = true;
          } else {
            await cf.updateAccessApp(String(readyApp.id), desired);
            mutated = true;
          }
        }
      }
    }

    if (!dryRun) {
      const appsVerify = await cf.listAccessApps();
      const readyVerify = findReadyApp(appsVerify, config.readyUri);
      if (!readyVerify) {
        throw new ConfigureAccessError("Ready bypass app missing after reconcile", "READY_MISSING");
      }
      const dest = Array.isArray(/** @type {Record<string, unknown>} */ (readyVerify).destinations)
        ? /** @type {Record<string, unknown>} */ (readyVerify).destinations.find(
            (d) =>
              d &&
              typeof d === "object" &&
              /** @type {Record<string, unknown>} */ (d).type === "public"
          )
        : null;
      const uri =
        dest && typeof dest === "object"
          ? String(/** @type {Record<string, unknown>} */ (dest).uri ?? "")
          : "";
      assertReadyPathExact(uri, config.workerHostname);
    }
  } catch (err) {
    failures += 1;
    safeLog(`error: ready reconcile failed: ${err instanceof Error ? err.message : err}`);
    throw err;
  }

  if (failures > 0) {
    throw new ConfigureAccessError(
      `Partial failure (${failures} stage(s) failed)`,
      "PARTIAL_FAILURE"
    );
  }

  if (dashboardAud) {
    safeLog(`CF_ACCESS_AUD=${dashboardAud}`);
  } else if (dryRun) {
    safeLog("CF_ACCESS_AUD=(available after create)");
  }
  safeLog(`team_domain=${teamDomain}`);

  const noop = !mutated && planned.length === 0;
  if (noop) {
    safeLog("result=noop (second-run / already reconciled)");
  } else if (dryRun) {
    safeLog(`result=dry-run planned_actions=${planned.length}`);
  } else {
    safeLog(`result=ok mutated=true actions=${planned.length}`);
  }

  return {
    teamDomain,
    workerId,
    dashboardAud,
    allowlistCount: config.allowlistCount,
    planned,
    mutated,
    noop,
    dryRun,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/configure-cloudflare-access.mjs [--dry-run]

Idempotent Cloudflare Access provisioning for UniFi Protect Assistant.

Required env:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  ALLOWED_EMAILS

Optional env:
  CF_ACCESS_TEAM_DOMAIN
  WORKER_NAME (default: ${WORKER_SCRIPT_NAME})
  WORKER_HOSTNAME (default: ${WORKER_SCRIPT_NAME}.mrcoffee.workers.dev)

Note: Access Bypass on the webhook app disables Access auth/logging for /unifi
only. Worker X-Webhook-Secret remains mandatory.
`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = loadConfigFromEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const log = createSafeLogger(console.log, {
    token: config.token,
    emails: config.emails,
  });

  try {
    await configureAccess({ config, dryRun: args.dryRun, log });
    process.exit(0);
  } catch (err) {
    if (err instanceof CloudflareApiError && err.isPermissionError) {
      log(`fatal: ${err.message}`);
    } else {
      log(`fatal: ${err instanceof Error ? err.message : err}`);
    }
    process.exit(1);
  }
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("configure-cloudflare-access.mjs") ||
    process.argv[1].includes("configure-cloudflare-access"));

if (isDirect) {
  main();
}
