import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from "jose";
import type { Env } from "../src/types.js";
import { clearJwksCacheForTests } from "../src/auth/cloudflareAccess.js";
import { renderLayout } from "../src/ui/layout.js";
import worker from "../src/index.js";

const TEAM = "https://example-team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const ALLOWED = "allowed@example.com";
const KID = "routing-test-kid";

let privateKey: KeyLike;
let publicJwk: JWK;
let fetchMock: ReturnType<typeof vi.fn>;

function mockCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function stubDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async run() {
              return { meta: { changes: 0 }, success: true };
            },
            async first() {
              if (String(sql).includes("sqlite_master")) {
                return { name: "face_events" };
              }
              return null;
            },
            async all() {
              return { results: [], meta: { changes: 0 } };
            },
          };
        },
        async run() {
          return { meta: { changes: 0 }, success: true };
        },
        async first() {
          if (String(sql).includes("sqlite_master")) {
            return { name: "face_events" };
          }
          return null;
        },
        async all() {
          return { results: [], meta: { changes: 0 } };
        },
      };
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;
}

function stubKv(): KVNamespace {
  return {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  } as unknown as KVNamespace;
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: stubDb(),
    KV: stubKv(),
    TIMEZONE: "America/New_York",
    WEBHOOK_SECRET: "test-secret",
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUD,
    ALLOWED_EMAILS: ALLOWED,
    ...overrides,
  };
}

async function signToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKey = priv;
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

beforeEach(() => {
  clearJwksCacheForTests();
  fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] }, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearJwksCacheForTests();
  vi.restoreAllMocks();
});

describe("Access routing gate", () => {
  const htmlRoutes = [
    "/",
    "/today",
    "/people",
    "/people/id%3Aabc",
    "/calendar",
    "/events",
    "/health",
  ];
  const jsonRoutes = [
    "/api/today",
    "/api/health",
    "/api/people",
    "/api/people/id%3Aabc",
    "/api/reports",
    "/api/events",
  ];

  it("gates every dashboard HTML route without an Access JWT", async () => {
    const env = baseEnv();
    for (const path of htmlRoutes) {
      const res = await worker.fetch(
        new Request(`https://unifi-protect-assistant.example.com${path}`),
        env,
        mockCtx()
      );
      expect(res.status, path).toBe(403);
      const text = await res.text();
      expect(text, path).not.toMatch(/allowed@example\.com|Cf-Access-Jwt/i);
    }
  });

  it("gates every authenticated JSON route without an Access JWT", async () => {
    const env = baseEnv();
    for (const path of jsonRoutes) {
      const res = await worker.fetch(
        new Request(`https://unifi-protect-assistant.example.com${path}`),
        env,
        mockCtx()
      );
      expect(res.status, path).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    }
  });

  it("allows a valid JWT with an allowlisted email through the gate", async () => {
    const token = await signToken("allowed@example.com");
    const res = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/", {
        headers: { "Cf-Access-Jwt-Assertion": token },
        redirect: "manual",
      }),
      baseEnv(),
      mockCtx()
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/today");
  });

  it("rejects a valid JWT from a non-allowlisted email", async () => {
    const token = await signToken("stranger@example.com");
    const res = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      baseEnv(),
      mockCtx()
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("does not require an Access JWT for POST /unifi but still requires the webhook secret", async () => {
    const missing = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/unifi", {
        method: "POST",
        body: "{}",
      }),
      baseEnv(),
      mockCtx()
    );
    expect(missing.status).toBe(401);

    const wrong = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "wrong" },
        body: "{}",
      }),
      baseEnv(),
      mockCtx()
    );
    expect(wrong.status).toBe(401);
  });

  it("returns 405 with Allow: POST for GET /unifi", async () => {
    const res = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/unifi", { method: "GET" }),
      baseEnv(),
      mockCtx()
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("keeps /ready public without Access JWT", async () => {
    const res = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/ready"),
      baseEnv(),
      mockCtx()
    );
    expect(res.status).toBe(200);
  });

  it("removes /login and /api/auth/* Better Auth routes", async () => {
    const env = baseEnv();
    for (const path of ["/login", "/api/auth/session", "/api/auth/sign-in/social"]) {
      const res = await worker.fetch(
        new Request(`https://unifi-protect-assistant.example.com${path}`),
        env,
        mockCtx()
      );
      expect(res.status, path).toBe(404);
    }
  });

  it("allows local bypass only on localhost hosts", async () => {
    const env = baseEnv({ ALLOW_LOCAL_AUTH_BYPASS: "true" });
    const local = await worker.fetch(
      new Request("http://localhost:8787/", { redirect: "manual" }),
      env,
      mockCtx()
    );
    expect(local.status).toBe(302);

    const prod = await worker.fetch(
      new Request("https://unifi-protect-assistant.example.com/", { redirect: "manual" }),
      env,
      mockCtx()
    );
    expect(prod.status).toBe(403);
  });

  it("points Sign out at Cloudflare Access logout", () => {
    const html = renderLayout("Test", "<p>body</p>", { nonce: "nonce" });
    expect(html).toContain('href="/cdn-cgi/access/logout"');
    expect(html).not.toMatch(/\/api\/auth|better-auth/i);
  });
});
