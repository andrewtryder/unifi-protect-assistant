import { describe, it, expect } from "vitest";
import { ingestWebhook } from "../src/webhook/ingester.js";
import { emptyCounters, mergeCounters, parseCountersJson } from "../src/ops/kvCounters.js";
import { getConfigWarnings } from "../src/ops/configWarnings.js";
import type { Env, FaceEvent } from "../src/types.js";

describe("ops counter helpers", () => {
  it("merges increments", () => {
    const base = emptyCounters();
    expect(mergeCounters(base, "duplicates", 3).duplicates).toBe(3);
    expect(mergeCounters(mergeCounters(base, "rejected_json"), "rejected_json").rejected_json).toBe(
      2
    );
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

  const accessComplete = {
    WEBHOOK_SECRET: "x",
    ALLOWED_EMAILS: "a@b.com",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    CF_ACCESS_AUD: "aud-test",
    HONEYBADGER_API_KEY: "hb_test",
  };

  it("warns on empty allowlist and missing webhook secret", () => {
    const warnings = getConfigWarnings(base);
    expect(warnings.some((w) => w.includes("WEBHOOK_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("ALLOWED_EMAILS"))).toBe(true);
  });

  it("warns on missing Cloudflare Access config and Honeybadger key", () => {
    const warnings = getConfigWarnings({
      ...base,
      WEBHOOK_SECRET: "x",
      ALLOWED_EMAILS: "a@b.com",
    });
    expect(warnings.some((w) => w.includes("CF_ACCESS_TEAM_DOMAIN"))).toBe(true);
    expect(warnings.some((w) => w.includes("CF_ACCESS_AUD"))).toBe(true);
    expect(warnings.some((w) => w.includes("HONEYBADGER_API_KEY"))).toBe(true);
    expect(warnings.some((w) => w.includes("BETTER_AUTH"))).toBe(false);
    expect(warnings.some((w) => w.includes("GOOGLE_CLIENT"))).toBe(false);
  });

  it("warns on invalid presence gap JSON", () => {
    const warnings = getConfigWarnings({
      ...base,
      ...accessComplete,
      PRESENCE_GAP_BY_PERSON: "{bad",
    });
    expect(warnings.some((w) => w.includes("PRESENCE_GAP_BY_PERSON"))).toBe(true);
  });

  it("returns empty when config looks complete", () => {
    const warnings = getConfigWarnings({
      ...base,
      ...accessComplete,
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

  function mockDb(parentChanges: number, childChanges: number[]) {
    return {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("webhook_notifications")) {
                  return { meta: { changes: parentChanges }, success: true };
                }
                return { meta: { changes: 0 }, success: true };
              },
              async first() {
                return parentChanges === 0 ? { id: "existing-notif" } : null;
              },
            };
          },
        };
      },
      async batch() {
        return childChanges.map((changes) => ({ meta: { changes } }));
      },
    } as unknown as D1Database;
  }

  it("counts inserts and duplicates from batch meta.changes", async () => {
    const env = {
      DB: mockDb(1, [1, 0]),
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
      [face("e1"), face("e2")],
      undefined,
      [],
      "delivery-key-1"
    );

    expect(result).toEqual({
      notificationInserted: true,
      notificationId: "notif",
      eventsAttempted: 2,
      eventsInserted: 1,
      duplicates: 1,
      vehiclesAttempted: 0,
      vehiclesInserted: 0,
      vehicleDuplicates: 0,
    });
  });

  it("counts vehicle inserts separately from faces", async () => {
    const env = {
      DB: mockDb(1, [1, 1, 0]),
      KV: {} as KVNamespace,
    } as unknown as Env;

    const vehicle = {
      id: "v1",
      notification_id: "n1",
      event_id: "ve1",
      seen_at_ms: 1000,
      local_date: "2025-07-14",
      plate_key: "plate:4444",
      plate_text: "4444",
      trigger_key: "license_plate_known",
      camera_id: "cam",
      alarm_name: "A",
      raw_trigger_json: "{}",
    };

    const result = await ingestWebhook(
      env,
      "notif",
      1,
      "0.0.0.0",
      "e",
      "alarm",
      "{}",
      [face("e1")],
      undefined,
      [vehicle, { ...vehicle, id: "v2", event_id: "ve2" }],
      "delivery-key-2"
    );

    expect(result).toEqual({
      notificationInserted: true,
      notificationId: "notif",
      eventsAttempted: 1,
      eventsInserted: 1,
      duplicates: 0,
      vehiclesAttempted: 2,
      vehiclesInserted: 1,
      vehicleDuplicates: 1,
    });
  });
});
