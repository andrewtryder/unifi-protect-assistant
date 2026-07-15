import { describe, it, expect } from "vitest";
import { escapeHtml } from "../src/ui/html.js";
import { renderLayout } from "../src/ui/layout.js";
import { renderCalendar } from "../src/ui/calendar.js";
import { renderEventsLog } from "../src/ui/events.js";
import type { DailyReport, FaceEvent } from "../src/types.js";

const ATTR_BREAKOUT = '"><img src=x onerror=alert(1)>';
const TITLE_BREAKOUT = "</title><script>alert(1)</script>";

describe("escapeHtml", () => {
  it("escapes attribute breakout payload", () => {
    const out = escapeHtml(ATTR_BREAKOUT);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain('"');
    expect(out).toBe("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes title/script breakout payload", () => {
    const out = escapeHtml(TITLE_BREAKOUT);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toBe("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes ampersands first and apostrophes", () => {
    expect(escapeHtml(`Tom & Jerry's`)).toBe("Tom &amp; Jerry&#39;s");
  });
});

describe("renderLayout title escaping", () => {
  it("escapes malicious page titles inside <title>", () => {
    const html = renderLayout(TITLE_BREAKOUT, "<p>ok</p>");
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
    expect(titleMatch).not.toBeNull();
    const titleInner = titleMatch![1];
    expect(titleInner).not.toContain("<script>");
    expect(titleInner).not.toContain("</title>");
    expect(titleInner).toContain(escapeHtml(TITLE_BREAKOUT));
  });
});

describe("calendar and events XSS sinks", () => {
  const report: DailyReport = {
    local_date: "2025-05-11",
    person_key: "name:xss",
    person_name: ATTR_BREAKOUT,
    first_seen_ms: Date.UTC(2025, 4, 11, 12, 0, 0),
    last_seen_ms: Date.UTC(2025, 4, 11, 14, 0, 0),
    raw_span_seconds: 7200,
    rounded_span_minutes: 120,
    rounded_span_hours: 2,
    first_event_id: "e1",
    last_event_id: "e2",
    first_camera_id: "cam",
    last_camera_id: "cam",
    seen_count: 2,
    generated_at_ms: Date.UTC(2025, 4, 11, 15, 0, 0),
    observed_rounded_hours: 2,
    session_count: 1,
  };

  const event: FaceEvent = {
    id: "1",
    notification_id: "n1",
    event_id: TITLE_BREAKOUT,
    seen_at_ms: Date.UTC(2025, 4, 11, 12, 0, 0),
    local_date: "2025-05-11",
    person_key: "name:xss",
    person_name: ATTR_BREAKOUT,
    person_id: "pid",
    trigger_key: ATTR_BREAKOUT,
    camera_id: ATTR_BREAKOUT,
    alarm_name: TITLE_BREAKOUT,
    raw_trigger_json: "{}",
  };

  it("escapes person_name in calendar tags and title attributes", () => {
    const html = renderCalendar("2025-05", [report], [], ATTR_BREAKOUT);
    expect(html).not.toContain(ATTR_BREAKOUT);
    expect(html).toContain(escapeHtml(ATTR_BREAKOUT));
    expect(html).not.toMatch(/title="[^"]*<img/);
  });

  it("escapes webhook fields in the events log", () => {
    const html = renderEventsLog("2025-05-11", [event], []);
    expect(html).not.toContain(ATTR_BREAKOUT);
    expect(html).not.toContain(TITLE_BREAKOUT);
    expect(html).toContain(escapeHtml(ATTR_BREAKOUT));
    expect(html).toContain(escapeHtml(TITLE_BREAKOUT));
  });

  it("rejects malicious data URLs in event thumbnails", () => {
    const evil: FaceEvent = {
      ...event,
      person_name: "Safe",
      trigger_key: "face_known",
      camera_id: "cam",
      event_id: "e1",
      alarm_name: "Alarm",
      image_base64: "data:text/html,<script>alert(1)</script>",
    };
    const html = renderEventsLog("2025-05-11", [evil], []);
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("no-image");
  });
});
