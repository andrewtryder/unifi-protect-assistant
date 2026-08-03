/**
 * Shared ALLOWED_EMAILS parser for Worker runtime and Access provisioning.
 * Exact-email allowlist only — no wildcards, domains, or Everyone semantics.
 */

export class AllowedEmailsError extends Error {
  constructor(message, code = "ALLOWED_EMAILS_INVALID") {
    super(message);
    this.name = "AllowedEmailsError";
    this.code = code;
  }
}

/** Structural email check — no wildcards or domain-only entries. */
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Parse comma-separated ALLOWED_EMAILS into a sorted unique lowercase list.
 * Fail closed on empty, malformed, or wildcard entries.
 */
export function parseAllowedEmailsStrict(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new AllowedEmailsError("ALLOWED_EMAILS is required and must be non-empty");
  }

  const parts = String(raw)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new AllowedEmailsError("ALLOWED_EMAILS is empty after normalization");
  }

  const seen = new Set();
  const emails = [];
  let duplicatesFound = false;

  for (const entry of parts) {
    if (entry.includes("*") || entry.startsWith("@") || !entry.includes("@")) {
      throw new AllowedEmailsError(
        "ALLOWED_EMAILS must contain exact email addresses only (no wildcards or domains)",
        "ALLOWED_EMAILS_WILDCARD"
      );
    }
    if (!EMAIL_RE.test(entry)) {
      throw new AllowedEmailsError(
        "ALLOWED_EMAILS contains a malformed email entry",
        "ALLOWED_EMAILS_MALFORMED"
      );
    }
    if (seen.has(entry)) {
      duplicatesFound = true;
      continue;
    }
    seen.add(entry);
    emails.push(entry);
  }

  emails.sort();
  return { emails, duplicatesFound, count: emails.length };
}

export function isEmailInAllowlist(email, allowlist) {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  return allowlist.includes(normalized);
}

export function parseAllowedEmailsSet(raw) {
  const { emails } = parseAllowedEmailsStrict(raw);
  return new Set(emails);
}
