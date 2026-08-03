import { createRemoteJWKSet, jwtVerify, errors as JoseErrors } from "jose";
import type { Env } from "../types.js";
import {
  AllowedEmailsError,
  isEmailInAllowlist,
  parseAllowedEmailsStrict,
} from "./allowedEmails.js";

export type AccessFailureClass =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "MISSING_ASSERTION"
  | "MALFORMED_TOKEN"
  | "INVALID_SIGNATURE"
  | "UNKNOWN_KID"
  | "WRONG_ISSUER"
  | "WRONG_AUDIENCE"
  | "EXPIRED"
  | "NOT_BEFORE"
  | "MISSING_EMAIL"
  | "EMAIL_NOT_ALLOWED"
  | "JWKS_FAILURE"
  | "VALIDATION_FAILED";

export class AccessAuthError extends Error {
  readonly code = "ACCESS_AUTH";
  constructor(
    readonly failureClass: AccessFailureClass,
    message = "Unauthorized"
  ) {
    super(message);
    this.name = "AccessAuthError";
  }
}

export interface AccessIdentity {
  email: string;
  allowlistCount: number;
}

export interface NormalizedAccessConfig {
  teamDomainOrigin: string;
  issuer: string;
  jwksUrl: URL;
  audience: string;
  allowedEmails: string[];
  duplicatesFound: boolean;
}

/** Module-scoped JWKS cache keyed by trusted team domain origin. */
const jwksByOrigin = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Normalize CF_ACCESS_TEAM_DOMAIN to a canonical https origin.
 * JWKS URL and issuer are derived only from this trusted config — never from the token.
 */
export function normalizeTeamDomain(raw: string | undefined): string {
  if (!raw?.trim()) {
    throw new AccessAuthError("CONFIG_MISSING", "CF_ACCESS_TEAM_DOMAIN is required");
  }
  let value = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AccessAuthError("CONFIG_INVALID", "CF_ACCESS_TEAM_DOMAIN is malformed");
  }
  if (url.protocol !== "https:") {
    throw new AccessAuthError("CONFIG_INVALID", "CF_ACCESS_TEAM_DOMAIN must use HTTPS");
  }
  if (!url.hostname.endsWith(".cloudflareaccess.com")) {
    throw new AccessAuthError(
      "CONFIG_INVALID",
      "CF_ACCESS_TEAM_DOMAIN must be a *.cloudflareaccess.com host"
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new AccessAuthError("CONFIG_INVALID", "CF_ACCESS_TEAM_DOMAIN must not include a path");
  }
  return url.origin;
}

export function loadAccessConfig(env: Env): NormalizedAccessConfig {
  const teamDomainOrigin = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = env.CF_ACCESS_AUD?.trim();
  if (!audience) {
    throw new AccessAuthError("CONFIG_MISSING", "CF_ACCESS_AUD is required");
  }

  let allowed;
  try {
    allowed = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
  } catch (err) {
    if (err instanceof AllowedEmailsError) {
      throw new AccessAuthError(
        err.code === "ALLOWED_EMAILS_MALFORMED" || err.code === "ALLOWED_EMAILS_WILDCARD"
          ? "CONFIG_INVALID"
          : "CONFIG_MISSING",
        "ALLOWED_EMAILS is invalid"
      );
    }
    throw err;
  }

  return {
    teamDomainOrigin,
    issuer: teamDomainOrigin,
    jwksUrl: new URL(`${teamDomainOrigin}/cdn-cgi/access/certs`),
    audience,
    allowedEmails: allowed.emails,
    duplicatesFound: allowed.duplicatesFound,
  };
}

function getJwks(origin: string, jwksUrl: URL) {
  let jwks = jwksByOrigin.get(origin);
  if (!jwks) {
    jwks = createRemoteJWKSet(jwksUrl);
    jwksByOrigin.set(origin, jwks);
  }
  return jwks;
}

/** Test helper — clear cached JWKS between unit tests. */
export function clearJwksCacheForTests(): void {
  jwksByOrigin.clear();
}

function mapJoseError(err: unknown): AccessFailureClass {
  if (err instanceof JoseErrors.JWTExpired) return "EXPIRED";
  if (err instanceof JoseErrors.JWTClaimValidationFailed) {
    const claim = (err as { claim?: string }).claim;
    if (claim === "aud") return "WRONG_AUDIENCE";
    if (claim === "iss") return "WRONG_ISSUER";
    if (claim === "nbf") return "NOT_BEFORE";
    if (claim === "exp") return "EXPIRED";
    return "VALIDATION_FAILED";
  }
  if (err instanceof JoseErrors.JWSSignatureVerificationFailed) return "INVALID_SIGNATURE";
  if (err instanceof JoseErrors.JWKSNoMatchingKey) return "UNKNOWN_KID";
  if (err instanceof JoseErrors.JWKSInvalid || err instanceof JoseErrors.JWKSTimeout) {
    return "JWKS_FAILURE";
  }
  // createRemoteJWKSet throws generic JOSEError on non-200 JWKS HTTP responses
  if (err instanceof JoseErrors.JOSEError && /JSON Web Key Set/i.test(err.message)) {
    return "JWKS_FAILURE";
  }
  if (err instanceof JoseErrors.JWTInvalid || err instanceof JoseErrors.JWSInvalid) {
    return "MALFORMED_TOKEN";
  }
  return "VALIDATION_FAILED";
}

/**
 * Validate Cf-Access-Jwt-Assertion and authorize the email against ALLOWED_EMAILS.
 */
export async function authenticateAccessRequest(
  request: Request,
  env: Env
): Promise<AccessIdentity> {
  const config = loadAccessConfig(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (!token) {
    throw new AccessAuthError("MISSING_ASSERTION");
  }

  let payload: Record<string, unknown>;
  try {
    const jwks = getJwks(config.teamDomainOrigin, config.jwksUrl);
    const verified = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AccessAuthError) throw err;
    throw new AccessAuthError(mapJoseError(err));
  }

  const rawEmail = typeof payload.email === "string" ? payload.email : null;
  if (!rawEmail?.trim()) {
    throw new AccessAuthError("MISSING_EMAIL");
  }
  const email = rawEmail.trim().toLowerCase();
  if (!isEmailInAllowlist(email, config.allowedEmails)) {
    throw new AccessAuthError("EMAIL_NOT_ALLOWED");
  }

  return { email, allowlistCount: config.allowedEmails.length };
}

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Explicit local-only bypass. Never inferred from a missing JWT.
 * Still requires a valid ALLOWED_EMAILS configuration.
 */
export function tryLocalAuthBypass(request: Request, env: Env): AccessIdentity | null {
  if (env.ALLOW_LOCAL_AUTH_BYPASS?.trim().toLowerCase() !== "true") {
    return null;
  }
  const host = new URL(request.url).hostname;
  if (!isLocalHost(host)) {
    throw new AccessAuthError("CONFIG_INVALID", "Local auth bypass rejected for this host");
  }
  // Still require a valid allowlist; Access JWT/AUD are not required for local UI only.
  let allowed;
  try {
    allowed = parseAllowedEmailsStrict(env.ALLOWED_EMAILS);
  } catch {
    throw new AccessAuthError("CONFIG_MISSING", "ALLOWED_EMAILS is invalid");
  }
  return {
    email: "local-bypass@localhost",
    allowlistCount: allowed.emails.length,
  };
}
