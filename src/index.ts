import { Env, UnifiWebhookPayload } from "./types.js";
import { parseWebhookPayload, getLocalDate } from "./webhook/parser.js";
import { ingestWebhook } from "./webhook/ingester.js";
import {
  getReportsForMonth,
  getEventsForDate,
  getDistinctPeople,
  getDistinctPeopleForDate,
  getDistinctPeopleForMonth,
} from "./db/queries.js";
import { ensureReportsForMonth, generateDailyReport } from "./reporting/generator.js";
import { runRetentionCleanup } from "./reporting/cleanup.js";
import { renderCalendar } from "./ui/calendar.js";
import { renderEventsLog } from "./ui/events.js";
import { renderLoginPage } from "./ui/login.js";
import { PersonSummary } from "./types.js";
import { createAuth } from "./auth.js";
import { isEmailAllowed } from "./auth-allowlist.js";

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

export default {
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
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const notificationId = crypto.randomUUID();
        const faceEvents = parseWebhookPayload(payload, notificationId, env);

        // Fetch basic info from payload for logging/notification storage
        const eventId = payload.alarm?.triggers?.[0]?.eventId || "N/A";
        const alarmName = payload.alarm?.name || "N/A";

        // Try extracting top-level or nested image Base64 string
        const payloadImageRaw = String((payload as any).image || payload.alarm?.image || "");
        const imageBase64 = payloadImageRaw.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(payloadImageRaw) ? payloadImageRaw : undefined;

        // Perform ingestion in background or synchronously.
        // We'll run synchronously to confirm storage back to the caller.
        await ingestWebhook(
          env,
          notificationId,
          receivedAtMs,
          clientIp,
          eventId,
          alarmName,
          rawBody,
          faceEvents,
          imageBase64
        );

        return new Response(JSON.stringify({
          success: true,
          events_ingested: faceEvents.length
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
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

    // 2. GET / - Redirect to /calendar (auth required)
    if (url.pathname === "/") {
      const gate = await requireDashboardAuth(request, env, "html");
      if (!gate.ok) return gate.response;
      const nowStr = getLocalDate(Date.now(), timezone);
      const currentMonth = nowStr.substring(0, 7); // YYYY-MM
      return Response.redirect(`${url.origin}/calendar?month=${currentMonth}`, 302);
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
      const people = await getDistinctPeople(env);
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
        console.log(`[Cron] Daily report successfully generated for ${yesterdayStr}`);
      } catch (err) {
        console.error(`[Cron] Error generating daily report for ${yesterdayStr}:`, err);
      }

      try {
        const cleanup = await runRetentionCleanup(env);
        console.log(`[Cron] Retention cleanup completed: purged ${cleanup.purgedNotifications} webhooks, ${cleanup.purgedEvents} events, ${cleanup.purgedReports} reports`);
      } catch (err) {
        console.error(`[Cron] Error running retention cleanup:`, err);
      }
    })());
  }
};
