import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet, type KeyLike } from "jose";
import type { Env } from "../src/types.js";
import {
  AccessAuthError,
  authenticateAccessRequest,
  clearJwksCacheForTests,
  loadAccessConfig,
  tryLocalAuthBypass,
} from "../src/auth/cloudflareAccess.js";
import { requireAccessAuth } from "../src/auth/gate.js";
import { AllowedEmailsError, parseAllowedEmailsStrict } from "../shared/allowedEmails.mjs";

const TEAM = "https://test.cloudflareaccess.com";
const AUD = "test-aud";
const JWKS_PATH = "/cdn-cgi/access/certs";
const ALLOWED = "allowed@example.com,other@example.com";
const KID = "test-key-1";

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;
let publicJwks: JSONWebKeySet;
let fetchMock: ReturnType<typeof vi.fn>;

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUD,
    ALLOWED_EMAILS: ALLOWED,
    ...overrides,
  };
}

function mockJwksOk(jwks: JSONWebKeySet = publicJwks) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

function mockJwksStatus(status: number) {
  fetchMock.mockResolvedValue(new Response("boom", { status }));
}

async function signToken(
  claims: Record<string, unknown>,
  opts: {
    kid?: string;
    key?: KeyLike;
    issuer?: string;
    audience?: string | string[] | undefined;
    exp?: string | number | Date;
    nbf?: string | number | Date;
    omitAud?: boolean;
  } = {}
): Promise<string> {
  const key = opts.key ?? privateKey;
  const builder = new SignJWT(claims).setProtectedHeader({
    alg: "RS256",
    kid: opts.kid ?? KID,
  });
  builder.setIssuer(opts.issuer ?? TEAM);
  if (!opts.omitAud) {
    builder.setAudience(opts.audience ?? AUD);
  }
  if (opts.exp !== undefined) builder.setExpirationTime(opts.exp);
  else builder.setExpirationTime("2h");
  if (opts.nbf !== undefined) builder.setNotBefore(opts.nbf);
  builder.setIssuedAt();
  return builder.sign(key);
}

function assertionRequest(token?: string, url = "https://app.example.com/"): Request {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  return new Request(url, { headers });
}

async function expectFailure(
  request: Request,
  env: Env,
  failureClass: string
): Promise<AccessAuthError> {
  try {
    await authenticateAccessRequest(request, env);
    throw new Error(`expected AccessAuthError(${failureClass})`);
  } catch (err) {
    expect(err).toBeInstanceOf(AccessAuthError);
    const e = err as AccessAuthError;
    expect(e.failureClass).toBe(failureClass);
    return e;
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const other = await generateKeyPair("RS256", { extractable: true });
  otherPrivateKey = other.privateKey;

  const pub = await exportJWK(pair.publicKey);
  pub.kid = KID;
  pub.alg = "RS256";
  pub.use = "sig";
  publicJwks = { keys: [pub] };
});

beforeEach(() => {
  clearJwksCacheForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockJwksOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearJwksCacheForTests();
});

describe("parseAllowedEmailsStrict", () => {
  it("normalizes case, trims whitespace, and drops duplicates", () => {
    const parsed = parseAllowedEmailsStrict(
      " Allowed@Example.com , other@example.com, allowed@example.com "
    );
    expect(parsed.emails).toEqual(["allowed@example.com", "other@example.com"]);
    expect(parsed.duplicatesFound).toBe(true);
    expect(parsed.count).toBe(2);
  });

  it("supports multiple distinct emails", () => {
    const parsed = parseAllowedEmailsStrict("a@ex.com,b@ex.com,c@ex.com");
    expect(parsed.emails).toEqual(["a@ex.com", "b@ex.com", "c@ex.com"]);
    expect(parsed.duplicatesFound).toBe(false);
  });

  it("rejects empty allowlist", () => {
    expect(() => parseAllowedEmailsStrict("")).toThrow(AllowedEmailsError);
    expect(() => parseAllowedEmailsStrict("  ,  ")).toThrow(AllowedEmailsError);
    expect(() => parseAllowedEmailsStrict(undefined)).toThrow(AllowedEmailsError);
  });

  it("rejects malformed and wildcard entries", () => {
    expect(() => parseAllowedEmailsStrict("not-an-email")).toThrow(/malformed|exact/i);
    expect(() => parseAllowedEmailsStrict("*@example.com")).toThrow(/wildcard|exact/i);
    expect(() => parseAllowedEmailsStrict("@example.com")).toThrow(/wildcard|exact/i);
  });
});

describe("loadAccessConfig", () => {
  it("loads normalized config from env", () => {
    const cfg = loadAccessConfig(baseEnv());
    expect(cfg.teamDomainOrigin).toBe(TEAM);
    expect(cfg.issuer).toBe(TEAM);
    expect(cfg.audience).toBe(AUD);
    expect(cfg.jwksUrl.href).toBe(`${TEAM}${JWKS_PATH}`);
    expect(cfg.allowedEmails).toEqual(["allowed@example.com", "other@example.com"]);
  });

  it("rejects empty allowlist as CONFIG_MISSING", () => {
    expect(() => loadAccessConfig(baseEnv({ ALLOWED_EMAILS: "" }))).toThrow(AccessAuthError);
    try {
      loadAccessConfig(baseEnv({ ALLOWED_EMAILS: "" }));
    } catch (err) {
      expect((err as AccessAuthError).failureClass).toBe("CONFIG_MISSING");
    }
  });

  it("rejects malformed allowlist as CONFIG_INVALID", () => {
    try {
      loadAccessConfig(baseEnv({ ALLOWED_EMAILS: "not-email" }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AccessAuthError);
      expect((err as AccessAuthError).failureClass).toBe("CONFIG_INVALID");
    }
  });
});

describe("authenticateAccessRequest", () => {
  it("accepts a valid JWT for an allowed email", async () => {
    const token = await signToken({ email: "allowed@example.com" });
    const identity = await authenticateAccessRequest(assertionRequest(token), baseEnv());
    expect(identity.email).toBe("allowed@example.com");
    expect(identity.allowlistCount).toBe(2);
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toBe(`${TEAM}${JWKS_PATH}`);
  });

  it("rejects a valid JWT with a disallowed email", async () => {
    const token = await signToken({ email: "stranger@example.com" });
    await expectFailure(assertionRequest(token), baseEnv(), "EMAIL_NOT_ALLOWED");
  });

  it("rejects missing assertion", async () => {
    await expectFailure(assertionRequest(), baseEnv(), "MISSING_ASSERTION");
  });

  it("rejects malformed JWT", async () => {
    await expectFailure(assertionRequest("not.a.jwt"), baseEnv(), "MALFORMED_TOKEN");
  });

  it("rejects invalid signature", async () => {
    const token = await signToken({ email: "allowed@example.com" }, { key: otherPrivateKey });
    await expectFailure(assertionRequest(token), baseEnv(), "INVALID_SIGNATURE");
  });

  it("rejects unknown kid", async () => {
    const token = await signToken({ email: "allowed@example.com" }, { kid: "no-such-kid" });
    await expectFailure(assertionRequest(token), baseEnv(), "UNKNOWN_KID");
  });

  it("rejects wrong issuer", async () => {
    const token = await signToken(
      { email: "allowed@example.com" },
      { issuer: "https://evil.cloudflareaccess.com" }
    );
    await expectFailure(assertionRequest(token), baseEnv(), "WRONG_ISSUER");
  });

  it("rejects wrong audience", async () => {
    const token = await signToken({ email: "allowed@example.com" }, { audience: "other-aud" });
    await expectFailure(assertionRequest(token), baseEnv(), "WRONG_AUDIENCE");
  });

  it("rejects missing audience in token", async () => {
    const token = await signToken({ email: "allowed@example.com" }, { omitAud: true });
    await expectFailure(assertionRequest(token), baseEnv(), "WRONG_AUDIENCE");
  });

  it("rejects expired tokens", async () => {
    const token = await signToken(
      { email: "allowed@example.com" },
      { exp: Math.floor(Date.now() / 1000) - 60 }
    );
    await expectFailure(assertionRequest(token), baseEnv(), "EXPIRED");
  });

  it("rejects nbf in the future", async () => {
    const token = await signToken(
      { email: "allowed@example.com" },
      { nbf: Math.floor(Date.now() / 1000) + 3600 }
    );
    await expectFailure(assertionRequest(token), baseEnv(), "NOT_BEFORE");
  });

  it("rejects missing email claim", async () => {
    const token = await signToken({ sub: "user-1" });
    await expectFailure(assertionRequest(token), baseEnv(), "MISSING_EMAIL");
  });

  it("normalizes email case against the allowlist", async () => {
    const token = await signToken({ email: "Allowed@Example.com" });
    const identity = await authenticateAccessRequest(assertionRequest(token), baseEnv());
    expect(identity.email).toBe("allowed@example.com");
  });

  it("accepts any of multiple allowlisted emails", async () => {
    const token = await signToken({ email: "other@example.com" });
    const identity = await authenticateAccessRequest(assertionRequest(token), baseEnv());
    expect(identity.email).toBe("other@example.com");
  });

  it("trims whitespace / duplicates in ALLOWED_EMAILS for auth", async () => {
    const env = baseEnv({
      ALLOWED_EMAILS: " allowed@example.com , other@example.com, Allowed@Example.com ",
    });
    const token = await signToken({ email: "other@example.com" });
    const identity = await authenticateAccessRequest(assertionRequest(token), env);
    expect(identity.allowlistCount).toBe(2);
  });

  it("maps JWKS HTTP 500 to JWKS_FAILURE", async () => {
    mockJwksStatus(500);
    const token = await signToken({ email: "allowed@example.com" });
    await expectFailure(assertionRequest(token), baseEnv(), "JWKS_FAILURE");
  });
});

describe("tryLocalAuthBypass", () => {
  it("allows bypass only on localhost when enabled", () => {
    const env = baseEnv({ ALLOW_LOCAL_AUTH_BYPASS: "true" });
    const identity = tryLocalAuthBypass(new Request("http://localhost:8787/"), env);
    expect(identity?.email).toBe("local-bypass@localhost");
    expect(identity?.allowlistCount).toBe(2);
  });

  it("rejects bypass on production hostname", () => {
    const env = baseEnv({ ALLOW_LOCAL_AUTH_BYPASS: "true" });
    expect(() => tryLocalAuthBypass(new Request("https://app.example.com/"), env)).toThrow(
      AccessAuthError
    );
    try {
      tryLocalAuthBypass(new Request("https://app.example.com/"), env);
    } catch (err) {
      expect((err as AccessAuthError).failureClass).toBe("CONFIG_INVALID");
    }
  });

  it("returns null when bypass flag is off", () => {
    expect(tryLocalAuthBypass(new Request("http://localhost/"), baseEnv())).toBeNull();
  });
});

describe("requireAccessAuth", () => {
  it("returns generic JSON errors without JWT or email leakage", async () => {
    const gate = await requireAccessAuth(assertionRequest(), baseEnv(), "json", "nonce", "req-1");
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(401);
    const body = await gate.response.json();
    expect(body).toEqual({ error: "Unauthorized" });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/jwt|assertion|allowed@|Cf-Access/i);
  });

  it("returns generic HTML denied page without email leakage", async () => {
    const token = await signToken({ email: "stranger@example.com" });
    const gate = await requireAccessAuth(
      assertionRequest(token),
      baseEnv(),
      "html",
      "nonce",
      "req-2"
    );
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(403);
    const html = await gate.response.text();
    expect(html).toMatch(/Access denied/i);
    expect(html).not.toContain("stranger@example.com");
    expect(html).not.toContain(token);
  });

  it("allows local bypass on localhost when enabled", async () => {
    const gate = await requireAccessAuth(
      new Request("http://127.0.0.1:8787/"),
      baseEnv({ ALLOW_LOCAL_AUTH_BYPASS: "true" }),
      "json",
      "nonce",
      "req-3"
    );
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.identity.email).toBe("local-bypass@localhost");
  });

  it("does not bypass on production host even when flag is set", async () => {
    const gate = await requireAccessAuth(
      new Request("https://prod.example.com/"),
      baseEnv({ ALLOW_LOCAL_AUTH_BYPASS: "true" }),
      "json",
      "nonce",
      "req-4"
    );
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body).toEqual({ error: "Forbidden" });
  });
});
