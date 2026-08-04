import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, htmlResponse } from "../src/http/responses.js";
import { renderLayout } from "../src/ui/layout.js";
import { renderTodayDashboard } from "../src/ui/today.js";
import { renderAccessDenied } from "../src/ui/accessDenied.js";
import { renderCalendar } from "../src/ui/calendar.js";
import { renderEventsLog } from "../src/ui/events.js";
import type { TodaySnapshot } from "../src/types.js";

const PUBLIC_ROOT = join(process.cwd(), "public");
const ASSETS_DIR = join(PUBLIC_ROOT, "assets");

const RESERVED_APP_PATHS = [
  "today",
  "people",
  "calendar",
  "events",
  "health",
  "ready",
  "unifi",
  "api",
  "login",
];

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function minimalTodaySnapshot(): TodaySnapshot {
  return {
    local_date: "2026-08-03",
    generated_at_ms: Date.now(),
    present_count: 0,
    seen_today_count: 0,
    unknown_face_count: 0,
    events_last_hour: 0,
    vehicles_present_count: 0,
    vehicles_seen_today_count: 0,
    vehicle_events_last_hour: 0,
    people: [],
    vehicles: [],
    recent_events: [],
    webhook: {
      healthy: true,
      last_received_at_ms: null,
      count_last_hour: 0,
    },
  };
}

describe("Workers Static Assets inventory", () => {
  it("ships the expected asset files", () => {
    for (const name of ["app.css", "app.js", "today.js", "favicon.svg"]) {
      const body = readFileSync(join(ASSETS_DIR, name), "utf8");
      expect(body.length).toBeGreaterThan(20);
    }
  });

  it("serves CSS and JS with the expected content shapes", () => {
    const css = readFileSync(join(ASSETS_DIR, "app.css"), "utf8");
    const js = readFileSync(join(ASSETS_DIR, "app.js"), "utf8");
    const today = readFileSync(join(ASSETS_DIR, "today.js"), "utf8");
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.card\s*\{/);
    expect(js).toMatch(/nav-today/);
    expect(js).toMatch(/person-filter/);
    expect(today).toMatch(/\/api\/today/);
    expect(today).not.toMatch(/today-bootstrap/);
  });

  it("does not place static files that shadow Worker routes", () => {
    const files = walkFiles(PUBLIC_ROOT).map((f) => relative(PUBLIC_ROOT, f).replace(/\\/g, "/"));
    for (const reserved of RESERVED_APP_PATHS) {
      expect(files.some((f) => f === reserved || f.startsWith(`${reserved}/`))).toBe(false);
    }
    expect(files.every((f) => f.startsWith("assets/"))).toBe(true);
  });

  it("keeps static assets free of private data markers", () => {
    const combined = walkFiles(ASSETS_DIR)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/@gmail\.com|ALLOWED_EMAILS|WEBHOOK_SECRET|CF_ACCESS|Bearer /i);
    expect(combined).not.toMatch(/payload_json|image_base64/i);
  });
});

describe("SSR HTML uses external assets", () => {
  it("layout links shared CSS/JS and has no inline style/script blocks", () => {
    const html = renderLayout("Test", "<p>body</p>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).toContain('href="/assets/favicon.svg"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
  });

  it("today page includes today.js and omits bootstrap JSON", () => {
    const html = renderTodayDashboard(minimalTodaySnapshot());
    expect(html).toContain('src="/assets/today.js"');
    expect(html).not.toContain("today-bootstrap");
    expect(html).not.toMatch(/<style[\s>]/i);
  });

  it("access denied page links app.css without inline styles", () => {
    const html = renderAccessDenied();
    expect(html).toContain('href="/assets/app.css"');
    expect(html).not.toMatch(/<style[\s>]/i);
  });

  it("calendar and events pages have no inline handlers or style/script blocks", () => {
    const calendar = renderCalendar("2026-08", [], []);
    const events = renderEventsLog("2026-08-03", [], []);
    for (const html of [calendar, events]) {
      expect(html).not.toMatch(/onchange=/i);
      expect(html).not.toMatch(/style=/i);
      expect(html).not.toMatch(/<style[\s>]/i);
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    }
    expect(calendar).toContain("data-base-path");
    expect(events).toContain('id="date-select"');
  });
});

describe("strict CSP", () => {
  it("has no nonce, unsafe-inline, or unsafe-eval", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toMatch(/nonce-|unsafe-inline|unsafe-eval/);
  });

  it("htmlResponse emits the strict CSP header", () => {
    const res = htmlResponse("<html></html>");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/nonce-|unsafe-inline|unsafe-eval/);
  });
});
