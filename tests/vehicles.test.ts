import { describe, expect, it } from "vitest";
import { sessionizeVehicleEvents } from "../src/reporting/sessions.js";
import type { VehicleEvent } from "../src/types.js";
import {
  renderVehiclesDirectory,
  renderVehicleProfile,
  renderVehicleEventsLog,
  renderVehicleNotFound,
} from "../src/ui/vehicles.js";
import type { VehicleProfile } from "../src/types.js";

function vehicle(
  partial: Partial<VehicleEvent> &
    Pick<VehicleEvent, "event_id" | "seen_at_ms" | "plate_key" | "plate_text">
): VehicleEvent {
  return {
    id: partial.id || partial.event_id,
    notification_id: partial.notification_id || "n1",
    event_id: partial.event_id,
    seen_at_ms: partial.seen_at_ms,
    local_date: partial.local_date || "2025-07-14",
    plate_key: partial.plate_key,
    plate_text: partial.plate_text,
    trigger_key: partial.trigger_key || "license_plate_known",
    camera_id: partial.camera_id || "cam-1",
    alarm_name: partial.alarm_name || "Alarm",
    raw_trigger_json: "{}",
  };
}

describe("sessionizeVehicleEvents", () => {
  const gap20m = () => 20 * 60 * 1000;

  it("splits distant sightings into separate visits", () => {
    const morning = Date.parse("2025-07-14T13:00:00Z");
    const evening = Date.parse("2025-07-14T21:00:00Z");
    const sessions = sessionizeVehicleEvents(
      [
        vehicle({
          event_id: "e1",
          seen_at_ms: morning,
          plate_key: "plate:ABC123",
          plate_text: "ABC123",
        }),
        vehicle({
          event_id: "e2",
          seen_at_ms: evening,
          plate_key: "plate:ABC123",
          plate_text: "ABC123",
        }),
      ],
      gap20m
    );
    expect(sessions).toHaveLength(2);
  });

  it("groups by plate_key independently", () => {
    const t0 = Date.parse("2025-07-14T13:00:00Z");
    const sessions = sessionizeVehicleEvents(
      [
        vehicle({
          event_id: "e1",
          seen_at_ms: t0,
          plate_key: "plate:AAA",
          plate_text: "AAA",
        }),
        vehicle({
          event_id: "e2",
          seen_at_ms: t0 + 1000,
          plate_key: "plate:BBB",
          plate_text: "BBB",
        }),
      ],
      gap20m
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.plate_key).sort()).toEqual(["plate:AAA", "plate:BBB"]);
  });
});

describe("vehicles UI", () => {
  it("directory and profile link external assets without inline scripts/styles", () => {
    const dir = renderVehiclesDirectory([
      {
        plate_key: "plate:ABC123",
        plate_text: "ABC123",
        first_seen_ms: 1,
        last_seen_ms: 2,
        event_count: 3,
      },
    ]);
    expect(dir).toContain("/vehicles/plate%3AABC123");
    expect(dir).toContain('href="/vehicles"');
    expect(dir).not.toMatch(/<style[\s>]/i);
    expect(dir).not.toMatch(/onchange=/i);

    const profile: VehicleProfile = {
      plate_key: "plate:ABC123",
      plate_text: "ABC123",
      first_seen_ms: 1,
      last_seen_ms: 2,
      event_count: 3,
      visit_count: 1,
      observed_span_seconds: 0,
      observed_rounded_hours: 0,
      typical_arrival_minutes: null,
      typical_departure_minutes: null,
      typical_arrival_label: null,
      typical_departure_label: null,
      cameras: [],
      heatmap: [],
      recent_events: [],
    };
    const html = renderVehicleProfile(profile);
    expect(html).toContain("ABC123");
    expect(html).toContain("/vehicle-events?");
    expect(html).not.toMatch(/style=/i);

    const missing = renderVehicleNotFound("plate:ZZZ");
    expect(missing).toContain("Vehicle not found");

    const log = renderVehicleEventsLog("2025-07-14", [], []);
    expect(log).toContain('id="plate-filter"');
    expect(log).toContain('id="date-select"');
    expect(log).not.toMatch(/onchange=/i);
  });
});
