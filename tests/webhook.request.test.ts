import { describe, it, expect } from "vitest";
import { handleUnifiWebhook } from "../src/webhook/handler.js";
import type { Env } from "../src/types.js";
import sampleKnown from "../fixtures/sample_face_known.json";

function mockCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return { meta: { changes: 1 }, success: true };
              },
              async first() {
                return null;
              },
              async all() {
                return { results: [], meta: { changes: 0 } };
              },
            };
          },
        };
      },
      async batch(stmts: unknown[]) {
        return (stmts as unknown[]).map(() => ({ meta: { changes: 1 } }));
      },
    } as unknown as D1Database,
    KV: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    } as unknown as KVNamespace,
    TIMEZONE: "America/New_York",
    WEBHOOK_SECRET: "test-secret",
    ...overrides,
  };
}

describe("POST /unifi request handling", () => {
  it("rejects missing secret with 503 when insecure mode is off", async () => {
    const env = baseEnv({ WEBHOOK_SECRET: undefined, ALLOW_INSECURE_WEBHOOKS: undefined });
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", { method: "POST", body: "{}" }),
      env,
      mockCtx(),
      "req-1"
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Service Unavailable");
    expect(JSON.stringify(body)).not.toMatch(/WEBHOOK_SECRET|SQL|secret/i);
  });

  it("rejects wrong secret with 401", async () => {
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "wrong" },
        body: "{}",
      }),
      baseEnv(),
      mockCtx(),
      "req-2"
    );
    expect(res.status).toBe(401);
  });

  it("accepts correct secret", async () => {
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "test-secret", "Content-Type": "application/json" },
        body: JSON.stringify(sampleKnown),
      }),
      baseEnv(),
      mockCtx(),
      "req-3"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("allows explicit local insecure mode without secret", async () => {
    const env = baseEnv({ WEBHOOK_SECRET: undefined, ALLOW_INSECURE_WEBHOOKS: "true" });
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        body: JSON.stringify(sampleKnown),
      }),
      env,
      mockCtx(),
      "req-4"
    );
    expect(res.status).toBe(200);
  });

  it("rejects oversized Content-Length with 413", async () => {
    const env = baseEnv({ MAX_WEBHOOK_BODY_BYTES: "128" });
    const request = new Request("https://example.com/unifi", {
      method: "POST",
      headers: { "X-Webhook-Secret": "test-secret" },
      body: "x".repeat(50),
    });
    Object.defineProperty(request, "headers", {
      value: new Headers({
        "X-Webhook-Secret": "test-secret",
        "Content-Length": "500",
      }),
    });
    const res = await handleUnifiWebhook(request, env, mockCtx(), "req-5");
    expect(res.status).toBe(413);
  });

  it("rejects oversized streamed body with 413", async () => {
    const env = baseEnv({ MAX_WEBHOOK_BODY_BYTES: "128" });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("y".repeat(400)));
        controller.close();
      },
    });
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "test-secret" },
        body: stream,
        // @ts-expect-error duplex required for streamed request body in some runtimes
        duplex: "half",
      }),
      env,
      mockCtx(),
      "req-6"
    );
    expect(res.status).toBe(413);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "test-secret" },
        body: "{not-json",
      }),
      baseEnv(),
      mockCtx(),
      "req-7"
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid timestamps with 400", async () => {
    const bad = {
      alarm: {
        name: "x",
        conditions: [],
        triggers: [
          {
            device: "cam",
            value: "A",
            key: "face_known",
            eventId: "e1",
            timestamp: Number.POSITIVE_INFINITY,
          },
        ],
      },
      timestamp: 1,
    };
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "test-secret" },
        body: JSON.stringify(bad),
      }),
      baseEnv(),
      mockCtx(),
      "req-8"
    );
    expect(res.status).toBe(400);
  });

  it("returns generic retriable status on D1 failure without internal text", async () => {
    const env = baseEnv();
    env.DB = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                throw new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;

    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", {
        method: "POST",
        headers: { "X-Webhook-Secret": "test-secret" },
        body: JSON.stringify(sampleKnown),
      }),
      env,
      mockCtx(),
      "req-9"
    );
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/FOREIGN KEY|SQLITE|Example Person|payload/i);
    expect(JSON.parse(text).error).toBe("Service Unavailable");
  });

  it("rejects unsupported methods with Allow: POST", async () => {
    const res = await handleUnifiWebhook(
      new Request("https://example.com/unifi", { method: "GET" }),
      baseEnv(),
      mockCtx(),
      "req-10"
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("secretsEqual constant-time", () => {
  it("matches equal secrets", async () => {
    const { secretsEqual } = await import("../src/webhook/auth.js");
    expect(await secretsEqual("abc", "abc")).toBe(true);
    expect(await secretsEqual("abc", "abd")).toBe(false);
    expect(await secretsEqual(null, "abc")).toBe(false);
  });
});
