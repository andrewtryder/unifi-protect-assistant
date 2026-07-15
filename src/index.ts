import { Env, UnifiWebhookPayload } from "./types.js";
import { parseWebhookPayload, getLocalDate } from "./webhook/parser.js";
import { ingestWebhook } from "./webhook/ingester.js";
import {
  getReportsForMonth,
  getEventsForDate,
  getDistinctPeopleForDate,
  getDistinctPeopleForMonth,
  getPeopleDirectory,
  getPersonProfile,
} from "./db/queries.js";
import { ensureReportsForMonth, generateDailyReport } from "./reporting/generator.js";
import { runRetentionCleanup } from "./reporting/cleanup.js";
import { renderCalendar } from "./ui/calendar.js";
import { renderEventsLog } from "./ui/events.js";
import { renderLoginPage } from "./ui/login.js";
import { renderTodayDashboard } from "./ui/today.js";
import {
  renderPeopleDirectory,
  renderPersonProfile,
  renderPersonNotFound,
} from "./ui/people.js";
import { PersonSummary } from "./types.js";
import { createAuth } from "./auth.js";
import { isEmailAllowed } from "./auth-allowlist.js";
import { buildTodaySnapshot } from "./reporting/sessions.js";
import {
  incrementCounter,
  setCleanupOk,
  setCronError,
  setCronReportOk,
  setD1Error,
} from "./ops/kvCounters.js";
import { buildHealthSnapshot } from "./ops/buildHealthSnapshot.js";
import { renderHealthPage } from "./ui/health.js";
import { withHoneybadger } from "@honeybadger-io/cloudflare";
import { reportError } from "./ops/honeybadger.js";

/**
 * Keeps a selected person visible in the dropdown when day/month navigation
 * lands on a range where they have no events.
 */
function withSelectedPerson(
  people: PersonSummary[],
  selectedPerson?: string
): PersonSummary[] {
  if (!selectedPerson) return people;
  const alreadyListed = people.some(
    p => p.person_name.toLowerCase() === selectedPerson.toLowerCase()
  );
  if (alreadyListed) return people;
  return [
    ...people,
    { person_name: selectedPerson, last_seen_ms: 0, event_count: 0 },
  ].sort((a, b) => a.person_name.localeCompare(b.person_name));
}

type AuthGate =
  | { ok: true }
  | { ok: false; response: Response };

async function requireDashboardAuth(
  request: Request,
  env: Env,
  mode: "html" | "json"
): Promise<AuthGate> {
  const auth = createAuth(env, new URL(request.url).origin);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    if (mode === "json") {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    const loginUrl = new URL("/login", request.url);
    return {
      ok: false,
      response: Response.redirect(loginUrl.toString(), 302),
    };
  }

  if (!isEmailAllowed(session.user.email, env)) {
    if (mode === "json") {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    return {
      ok: false,
      response: new Response(renderLoginPage("Your email is not authorized to access this app."), {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    };
  }

  return { ok: true };
}

export default withHoneybadger(
  (env: Env) => ({
    apiKey: env.HONEYBADGER_API_KEY,
    environment: "production",
  }),
  {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const timezone = env.TIMEZONE || "America/New_York";

    // better-auth endpoints (Google OAuth, session, sign-out)
    if (url.pathname.startsWith("/api/auth")) {
      try {
        const auth = createAuth(env, url.origin);
        return await auth.handler(request);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        console.error("[auth] handler error:", message, stack);
        reportError(env, ctx, err, { component: "auth", path: url.pathname });
        return new Response(JSON.stringify({ error: "Internal Server Error", message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 1. POST /unifi - Webhook ingestion (shared secret only; not Google auth)
    if (url.pathname === "/unifi") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      // Authentication
      const secretHeader = request.headers.get("X-Webhook-Secret");
      const expectedSecret = env.WEBHOOK_SECRET;
      if (expectedSecret && secretHeader !== expectedSecret) {
        ctx.waitUntil(incrementCounter(env, "rejected_auth").catch(() => undefined));
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const receivedAtMs = Date.now();
        const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
        const rawBody = await request.text();
        
        let payload: UnifiWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          ctx.waitUntil(incrementCounter(env, "rejected_json").catch(() => undefined));
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const notificationId = crypto.randomUUID();
        const { faceEvents, vehicleEvents } = parseWebhookPayload(payload, notificationId, env);

        // No face or plate detections extracted from this payload
        if (faceEvents.length === 0 && vehicleEvents.length === 0) {
          ctx.waitUntil(incrementCounter(env, "zero_face_webhooks").catch(() => undefined));
        }

        // Fetch basic info from payload for logging/notification storage
        const eventId = payload.alarm?.triggers?.[0]?.eventId || "N/A";
        const alarmName = payload.alarm?.name || "N/A";

        // Try extracting top-level or nested image Base64 string
        const payloadImageRaw = String((payload as any).image || payload.alarm?.image || "");
        const imageBase64 = payloadImageRaw.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(payloadImageRaw) ? payloadImageRaw : undefined;

        const ingestResult = await ingestWebhook(
          env,
          notificationId,
          receivedAtMs,
          clientIp,
          eventId,
          alarmName,
          rawBody,
          faceEvents,
          imageBase64,
          vehicleEvents
        );

        ctx.waitUntil((async () => {
          await incrementCounter(env, "ingested_webhooks");
          if (ingestResult.eventsAttempted > 0) {
            await incrementCounter(env, "events_attempted", ingestResult.eventsAttempted);
          }
          if (ingestResult.eventsInserted > 0) {
            await incrementCounter(env, "events_inserted", ingestResult.eventsInserted);
          }
          if (ingestResult.duplicates > 0) {
            await incrementCounter(env, "duplicates", ingestResult.duplicates);
          }
          if (ingestResult.vehiclesAttempted > 0) {
            await incrementCounter(env, "vehicles_attempted", ingestResult.vehiclesAttempted);
          }
          if (ingestResult.vehiclesInserted > 0) {
            await incrementCounter(env, "vehicles_inserted", ingestResult.vehiclesInserted);
          }
          if (ingestResult.vehicleDuplicates > 0) {
            await incrementCounter(env, "vehicle_duplicates", ingestResult.vehicleDuplicates);
          }
        })().catch(() => undefined));

        return new Response(JSON.stringify({
          success: true,
          events_ingested: ingestResult.eventsInserted,
          events_attempted: ingestResult.eventsAttempted,
          duplicates: ingestResult.duplicates,
          vehicles_ingested: ingestResult.vehiclesInserted,
          vehicles_attempted: ingestResult.vehiclesAttempted,
          vehicle_duplicates: ingestResult.vehicleDuplicates,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        const message = err instanceof Error ? err.message : String(err);
        reportError(env, ctx, err, { component: "webhook", path: "/unifi" });
        ctx.waitUntil((async () => {
          await incrementCounter(env, "d1_failures");
          await setD1Error(env, message);
        })().catch(() => undefined));
        return new Response(JSON.stringify({ error: "Internal Server Error", message }), {
          status: 200, // Do not crash/return error code to webhook provider
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Login page (public)
    if (url.pathname === "/login") {
      const error = url.searchParams.get("error") || undefined;
      return new Response(renderLoginPage(error || undefined), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // 2. GET / - Redirect to /today (auth required)
    if (url.pathname === "/") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      return Response.redirect(`${url.origin}/today`, 302);
    }

    // Today live dashboard
    if (url.pathname === "/today") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      const snapshot = await buildTodaySnapshot(env);
      return new Response(renderTodayDashboard(snapshot), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/api/today") {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      const snapshot = await buildTodaySnapshot(env);
      return new Response(JSON.stringify(snapshot), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    // Health / diagnostics
    if (url.pathname === "/health") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      const snapshot = await buildHealthSnapshot(env);
      return new Response(renderHealthPage(snapshot), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/api/health") {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      const snapshot = await buildHealthSnapshot(env);
      return new Response(JSON.stringify(snapshot), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    // People directory
    if (url.pathname === "/people") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      const people = await getPeopleDirectory(env);
      return new Response(renderPeopleDirectory(people), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Person profile: /people/:personKey
    if (url.pathname.startsWith("/people/")) {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      const personKey = decodeURIComponent(url.pathname.slice("/people/".length));
      if (!personKey) {
        return Response.redirect(`${url.origin}/people`, 302);
      }
      const profile = await getPersonProfile(env, personKey);
      if (!profile) {
        return new Response(renderPersonNotFound(personKey), {
          status: 404,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(renderPersonProfile(profile), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // JSON person profile
    if (url.pathname.startsWith("/api/people/")) {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      const personKey = decodeURIComponent(url.pathname.slice("/api/people/".length));
      const profile = await getPersonProfile(env, personKey);
      if (!profile) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. GET /calendar
    if (url.pathname === "/calendar") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      let month = url.searchParams.get("month");
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        month = getLocalDate(Date.now(), timezone).substring(0, 7);
      }
      const person = url.searchParams.get("person") || undefined;
      await ensureReportsForMonth(env, month);
      const [reports, people] = await Promise.all([
        getReportsForMonth(env, month, person),
        getDistinctPeopleForMonth(env, month),
      ]);
      return new Response(
        renderCalendar(month, reports, withSelectedPerson(people, person), person),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // 4. GET /events
    if (url.pathname === "/events") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      let date = url.searchParams.get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        date = getLocalDate(Date.now(), timezone);
      }
      const person = url.searchParams.get("person") || undefined;
      const [events, people] = await Promise.all([
        getEventsForDate(env, date, person),
        getDistinctPeopleForDate(env, date),
      ]);
      return new Response(
        renderEventsLog(date, events, withSelectedPerson(people, person), person),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // 5. GET /api/reports?month=YYYY-MM
    if (url.pathname === "/api/reports") {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      let month = url.searchParams.get("month");
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        month = getLocalDate(Date.now(), timezone).substring(0, 7);
      }
      const person = url.searchParams.get("person") || undefined;
      await ensureReportsForMonth(env, month);
      const reports = await getReportsForMonth(env, month, person);
      return new Response(JSON.stringify(reports), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 6. GET /api/events?date=YYYY-MM-DD
    if (url.pathname === "/api/events") {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      let date = url.searchParams.get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        date = getLocalDate(Date.now(), timezone);
      }
      const person = url.searchParams.get("person") || undefined;
      const events = await getEventsForDate(env, date, person);
      return new Response(JSON.stringify(events), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 7. GET /api/people
    if (url.pathname === "/api/people") {
      const gate = await requireDashboardAuth(request, env, "json");
      if (!gate.ok) return gate.response;
      const people = await getPeopleDirectory(env);
      return new Response(JSON.stringify(people), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const timezone = env.TIMEZONE || "America/New_York";
    // Daily cron runs once a day. It should compute the PREVIOUS local day's reports.
    // e.g. run at 6:00 AM UTC = 2:00 AM EST, we compute the report for "yesterday"
    const now = Date.now();
    
    // Find local date of 12 hours ago to guarantee we get yesterday's date
    const yesterdayMs = now - 12 * 60 * 60 * 1000;
    const yesterdayStr = getLocalDate(yesterdayMs, timezone);

    console.log(`[Cron] Starting daily reporting & cleanup. Reporting date: ${yesterdayStr}`);

    ctx.waitUntil((async () => {
      try {
        await generateDailyReport(env, yesterdayStr);
        await setCronReportOk(env, yesterdayStr, Date.now());
        console.log(`[Cron] Daily report successfully generated for ${yesterdayStr}`);
      } catch (err) {
        console.error(`[Cron] Error generating daily report for ${yesterdayStr}:`, err);
        reportError(env, ctx, err, { component: "cron", path: "generateDailyReport" });
        await setCronError(
          env,
          err instanceof Error ? err.message : String(err)
        ).catch(() => undefined);
      }

      try {
        const cleanup = await runRetentionCleanup(env);
        await setCleanupOk(env, {
          purgedNotifications: cleanup.purgedNotifications,
          purgedEvents: cleanup.purgedEvents,
          purgedReports: cleanup.purgedReports,
          purgedSessions: cleanup.purgedSessions,
        });
        console.log(`[Cron] Retention cleanup completed: purged ${cleanup.purgedNotifications} webhooks, ${cleanup.purgedEvents} events, ${cleanup.purgedReports} reports, ${cleanup.purgedSessions} sessions`);
      } catch (err) {
        console.error(`[Cron] Error running retention cleanup:`, err);
        reportError(env, ctx, err, { component: "cron", path: "runRetentionCleanup" });
        await setCronError(
          env,
          err instanceof Error ? err.message : String(err)
        ).catch(() => undefined);
      }
    })());
  },
  }
);
