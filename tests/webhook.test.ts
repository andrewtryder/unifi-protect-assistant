import { describe, it, expect } from "vitest";
import { parseWebhookPayload, getLocalDate, normalizePlateKey } from "../src/webhook/parser.js";
import { Env } from "../src/types.js";
import sampleKnown from "../fixtures/sample_face_known.json";
import sampleUnknown from "../fixtures/sample_face_unknown.json";
import samplePlate from "../fixtures/sample_license_plate_known.json";
import samplePlateTest from "../fixtures/sample_license_plate_test.json";

describe("Webhook Parser & Matching Tests", () => {
  const mockEnv: Env = {
    DB: {} as any,
    KV: {} as any,
    TIMEZONE: "America/New_York"
  };

  it("should extract fields correctly from a known face trigger", () => {
    const { faceEvents, vehicleEvents } = parseWebhookPayload(sampleKnown, "notif-123", mockEnv);
    expect(faceEvents).toHaveLength(1);
    expect(vehicleEvents).toHaveLength(0);
    const event = faceEvents[0];
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
    const { faceEvents } = parseWebhookPayload(sampleUnknown, "notif-456", mockEnv);
    expect(faceEvents).toHaveLength(1);
    const event = faceEvents[0];
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
    expect(matched.faceEvents).toHaveLength(1);

    const unmatched = parseWebhookPayload(sampleUnknown, "notif-456", envWithNameFilter);
    expect(unmatched.faceEvents).toHaveLength(0);
  });

  it("should filter by target ID if configured", () => {
    const envWithIdFilter: Env = {
      ...mockEnv,
      TARGET_PERSON_IDS: "example-person-id"
    };

    const matched = parseWebhookPayload(sampleKnown, "notif-123", envWithIdFilter);
    expect(matched.faceEvents).toHaveLength(1);

    const unmatched = parseWebhookPayload(sampleUnknown, "notif-456", envWithIdFilter);
    expect(unmatched.faceEvents).toHaveLength(0);
  });

  it("should not match if target filters are active and both names and IDs fail matching", () => {
    const envWithBothFilters: Env = {
      ...mockEnv,
      TARGET_PERSON_NAMES: "Some Other Person",
      TARGET_PERSON_IDS: "some-other-id"
    };

    const matched = parseWebhookPayload(sampleKnown, "notif-123", envWithBothFilters);
    expect(matched.faceEvents).toHaveLength(0);
  });

  it("should extract license plate events with plate text", () => {
    const { faceEvents, vehicleEvents } = parseWebhookPayload(samplePlate, "notif-plate", mockEnv);
    expect(faceEvents).toHaveLength(0);
    expect(vehicleEvents).toHaveLength(1);
    const event = vehicleEvents[0];
    expect(event.plate_text).toBe("4444");
    expect(event.plate_key).toBe("plate:4444");
    expect(event.trigger_key).toBe("license_plate_known");
    expect(event.camera_id).toBe("FAKE_MAC");
    expect(event.event_id).toBe("plate-event-id");
  });

  it("should store test plate fires without value as plate:unknown", () => {
    const { vehicleEvents } = parseWebhookPayload(samplePlateTest, "notif-test", mockEnv);
    expect(vehicleEvents).toHaveLength(1);
    expect(vehicleEvents[0].plate_text).toBe("");
    expect(vehicleEvents[0].plate_key).toBe("plate:unknown");
    expect(vehicleEvents[0].event_id).toMatch(/^testEventId-/);
  });

  it("should parse mixed face and plate triggers in one payload", () => {
    const mixed = {
      alarm: {
        name: "Mixed",
        conditions: [
          { condition: { type: "is", source: "face_known", value: "pid" } },
        ],
        triggers: [
          {
            device: "cam1",
            value: "Alice",
            key: "face_known",
            eventId: "face-1",
            timestamp: 1000,
          },
          {
            device: "cam2",
            value: "AB-12",
            key: "license_plate_known",
            eventId: "plate-1",
            timestamp: 2000,
          },
        ],
      },
      timestamp: 3000,
    };
    const { faceEvents, vehicleEvents } = parseWebhookPayload(mixed, "n", mockEnv);
    expect(faceEvents).toHaveLength(1);
    expect(vehicleEvents).toHaveLength(1);
    expect(normalizePlateKey("AB-12")).toBe("plate:AB12");
    expect(vehicleEvents[0].plate_key).toBe("plate:AB12");
  });
});

describe("getLocalDate", () => {
  it("formats in the given timezone", () => {
    // Fixed UTC instant
    expect(getLocalDate(1746970986798, "UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
