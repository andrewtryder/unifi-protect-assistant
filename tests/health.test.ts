import { describe, it, expect } from "vitest";
import {
  emptyCounters,
  mergeCounters,
  parseCountersJson,
} from "../src/ops/kvCounters.js";
import { getConfigWarnings } from "../src/ops/configWarnings.js";
import type { Env } from "../src/types.js";
import { ingestWebhook } from "../src/webhook/ingester.js";
import type { FaceEvent } from "../src/types.js";

describe("ops counter helpers", () => {
  it("merges increments", () => {
    const base = emptyCounters();
    expect(mergeCounters(base, "duplicates", 3).duplicates).toBe(3);
    expect(mergeCounters(mergeCounters(base, "rejected_json"), "rejected_json").rejected_json).toBe(2);
  });

  it("parses counter JSON with defaults", () => {
    expect(parseCountersJson(null).ingested_webhooks).toBe(0);
    expect(parseCountersJson('{"duplicates":5}').duplicates).toBe(5);
    expect(parseCountersJson("not-json").rejected_auth).toBe(0);
  });
});

describe("getConfigWarnings", () => {
  const base: Env = {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
  };

  it("warns on empty allowlist and missing webhook secret", () => {
    const warnings = getConfigWarnings(base);
    expect(warnings.some((w) => w.includes("WEBHOOK_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("ALLOWED_EMAILS"))).toBe(true);
  });

  it("warns on missing auth secret and infrastructure API key separately", () => {
    const warnings = getConfigWarnings({
      ...base,
      WEBHOOK_SECRET: "x",
      ALLOWED_EMAILS: "a@b.com",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(warnings.some((w) => w.includes("BETTER_AUTH_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("BETTER_AUTH_API_KEY"))).toBe(true);
  });

  it("warns on invalid presence gap JSON", () => {
    const warnings = getConfigWarnings({
      ...base,
      WEBHOOK_SECRET: "x",
      ALLOWED_EMAILS: "a@b.com",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "secret-secret-secret-secret-secret",
      BETTER_AUTH_API_KEY: "ba_test",
      PRESENCE_GAP_BY_PERSON: "{bad",
    });
    expect(warnings.some((w) => w.includes("PRESENCE_GAP_BY_PERSON"))).toBe(true);
  });

  it("returns empty when config looks complete", () => {
    const warnings = getConfigWarnings({
      ...base,
      WEBHOOK_SECRET: "x",
      ALLOWED_EMAILS: "a@b.com",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "secret-secret-secret-secret-secret",
      BETTER_AUTH_API_KEY: "ba_test",
    });
    expect(warnings).toEqual([]);
  });
});

describe("ingestWebhook stats", () => {
  function face(eventId: string): FaceEvent {
    return {
      id: `id-${eventId}`,
      notification_id: "n1",
      event_id: eventId,
      seen_at_ms: 1000,
      local_date: "2025-07-14",
      person_key: "id:a",
      person_name: "Alice",
      person_id: "a",
      trigger_key: "face_known",
      camera_id: "cam",
      alarm_name: "A",
      raw_trigger_json: "{}",
    };
  }

  it("counts inserts and duplicates from batch meta.changes", async () => {
    const batchMeta = [
      { meta: { changes: 1 } }, // notification
      { meta: { changes: 1 } }, // event insert
      { meta: { changes: 0 } }, // duplicate ignore
    ];
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {};
            },
          };
        },
        async batch() {
          return batchMeta;
        },
      },
      KV: {} as KVNamespace,
    } as unknown as Env;

    const result = await ingestWebhook(
      env,
      "notif",
      1,
      "0.0.0.0",
      "e",
      "alarm",
      "{}",
      [face("e1"), face("e2")]
    );

    expect(result).toEqual({
      eventsAttempted: 2,
      eventsInserted: 1,
      duplicates: 1,
    });
  });
});
