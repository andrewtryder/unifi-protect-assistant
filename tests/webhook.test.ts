import { describe, it, expect } from "vitest";
import { parseWebhookPayload, getLocalDate } from "../src/webhook/parser.js";
import { Env } from "../src/types.js";
import sampleKnown from "../fixtures/sample_face_known.json";
import sampleUnknown from "../fixtures/sample_face_unknown.json";

describe("Webhook Parser & Matching Tests", () => {
  const mockEnv: Env = {
    DB: {} as any,
    KV: {} as any,
    TIMEZONE: "America/New_York"
  };

  it("should extract fields correctly from a known face trigger", () => {
    const events = parseWebhookPayload(sampleKnown, "notif-123", mockEnv);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.notification_id).toBe("notif-123");
    expect(event.event_id).toBe("example-event-id");
    expect(event.person_name).toBe("Example Person");
    expect(event.person_id).toBe("example-person-id");
    expect(event.person_key).toBe("id:example-person-id");
    expect(event.trigger_key).toBe("face_known");
    expect(event.camera_id).toBe("example-camera-id");
    expect(event.alarm_name).toBe("Example Person Detected");
    expect(event.seen_at_ms).toBe(1746970986798);
  });

  it("should extract fields correctly from an unknown face trigger", () => {
    const events = parseWebhookPayload(sampleUnknown, "notif-456", mockEnv);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.person_name).toBe("Unknown");
    expect(event.person_id).toBe("");
    expect(event.person_key).toBe("name:unknown");
    expect(event.trigger_key).toBe("face_unknown");
  });

  it("should filter by target name if configured", () => {
    const envWithNameFilter: Env = {
      ...mockEnv,
      TARGET_PERSON_NAMES: "Example Person"
    };

    const matched = parseWebhookPayload(sampleKnown, "notif-123", envWithNameFilter);
    expect(matched).toHaveLength(1);

    const unmatched = parseWebhookPayload(sampleUnknown, "notif-456", envWithNameFilter);
    expect(unmatched).toHaveLength(0);
  });

  it("should filter by target ID if configured", () => {
    const envWithIdFilter: Env = {
      ...mockEnv,
      TARGET_PERSON_IDS: "example-person-id"
    };

    const matched = parseWebhookPayload(sampleKnown, "notif-123", envWithIdFilter);
    expect(matched).toHaveLength(1);

    const unmatched = parseWebhookPayload(sampleUnknown, "notif-456", envWithIdFilter);
    expect(unmatched).toHaveLength(0);
  });

  it("should not match if target filters are active and both names and IDs fail matching", () => {
    const envWithBothFilters: Env = {
      ...mockEnv,
      TARGET_PERSON_NAMES: "Some Other Person",
      TARGET_PERSON_IDS: "some-other-id"
    };

    const matched = parseWebhookPayload(sampleKnown, "notif-123", envWithBothFilters);
    expect(matched).toHaveLength(0);
  });
});
