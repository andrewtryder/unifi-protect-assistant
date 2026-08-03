import { Env } from "./types.js";
import { handleUnifiWebhook } from "./webhook/handler.js";
import { getLocalDate } from "./webhook/parser.js";
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
import { renderTodayDashboard } from "./ui/today.js";
import { renderPeopleDirectory, renderPersonProfile, renderPersonNotFound } from "./ui/people.js";
import { PersonSummary } from "./types.js";
import { buildTodaySnapshot } from "./reporting/sessions.js";
import {
  classifyDbError,
  setCleanupOk,
  setCronError,
  setCronReportOk,
  setFkCheckOk,
} from "./ops/kvCounters.js";
import { buildHealthSnapshot } from "./ops/buildHealthSnapshot.js";
import { renderHealthPage } from "./ui/health.js";
import { withHoneybadger } from "@honeybadger-io/cloudflare";
import { reportError } from "./ops/honeybadger.js";
import { DEFAULT_TIMEZONE } from "./config.js";
import { resolveRequestId, withRequestIdHeader } from "./http/requestId.js";
import {
  genericErrorResponse,
  htmlResponse,
  jsonResponse,
  methodNotAllowed,
  newRequestNonce,
  textResponse,
} from "./http/responses.js";
import {
  isValidLocalDateString,
  isValidMonthString,
  safeDecodeURIComponent,
} from "./http/dates.js";
import { handleReady } from "./http/ready.js";
import { requireAccessAuth } from "./auth/gate.js";

function withSelectedPerson(people: PersonSummary[], selectedPerson?: string): PersonSummary[] {
  if (!selectedPerson) return people;
  const alreadyListed = people.some(
    (p) => p.person_name.toLowerCase() === selectedPerson.toLowerCase()
  );
  if (alreadyListed) return people;
  return [...people, { person_name: selectedPerson, last_seen_ms: 0, event_count: 0 }].sort(
    (a, b) => a.person_name.localeCompare(b.person_name)
  );
}

function requireGet(request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  return methodNotAllowed(["GET", "HEAD"]);
}

export default withHoneybadger(
  (env: Env) => ({
    apiKey: env.HONEYBADGER_API_KEY,
    environment: "production",
  }),
  {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const requestId = resolveRequestId(request);
      const nonce = newRequestNonce();
      const timezone = env.TIMEZONE || DEFAULT_TIMEZONE;

      if (url.pathname === "/ready") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return methodNotAllowed(["GET", "HEAD"]);
        }
        const res = await handleReady(env);
        const headers = withRequestIdHeader(res.headers, requestId);
        return new Response(res.body, { status: res.status, headers });
      }

      if (url.pathname === "/unifi") {
        return handleUnifiWebhook(request, env, ctx, requestId);
      }

      if (url.pathname === "/") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        return Response.redirect(`${url.origin}/today`, 302);
      }

      if (url.pathname === "/today") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        const snapshot = await buildTodaySnapshot(env);
        return htmlResponse(renderTodayDashboard(snapshot, nonce), {
          nonce,
          extra: withRequestIdHeader(undefined, requestId),
        });
      }

      if (url.pathname === "/api/today") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        const snapshot = await buildTodaySnapshot(env);
        return jsonResponse(snapshot, { extra: withRequestIdHeader(undefined, requestId) });
      }

      if (url.pathname === "/health") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        const snapshot = await buildHealthSnapshot(env);
        return htmlResponse(renderHealthPage(snapshot, nonce), {
          nonce,
          extra: withRequestIdHeader(undefined, requestId),
        });
      }

      if (url.pathname === "/api/health") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        const snapshot = await buildHealthSnapshot(env);
        return jsonResponse(snapshot, { extra: withRequestIdHeader(undefined, requestId) });
      }

      if (url.pathname === "/people") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        const people = await getPeopleDirectory(env);
        return htmlResponse(renderPeopleDirectory(people, nonce), {
          nonce,
          extra: withRequestIdHeader(undefined, requestId),
        });
      }

      if (url.pathname.startsWith("/people/")) {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        const personKey = safeDecodeURIComponent(url.pathname.slice("/people/".length));
        if (personKey === null) {
          return genericErrorResponse(
            400,
            "Bad Request",
            withRequestIdHeader(undefined, requestId)
          );
        }
        if (!personKey) {
          return Response.redirect(`${url.origin}/people`, 302);
        }
        const profile = await getPersonProfile(env, personKey);
        if (!profile) {
          return htmlResponse(renderPersonNotFound(personKey, nonce), {
            status: 404,
            nonce,
            extra: withRequestIdHeader(undefined, requestId),
          });
        }
        return htmlResponse(renderPersonProfile(profile, nonce), {
          nonce,
          extra: withRequestIdHeader(undefined, requestId),
        });
      }

      if (url.pathname.startsWith("/api/people/")) {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        const personKey = safeDecodeURIComponent(url.pathname.slice("/api/people/".length));
        if (personKey === null) {
          return genericErrorResponse(
            400,
            "Bad Request",
            withRequestIdHeader(undefined, requestId)
          );
        }
        const profile = await getPersonProfile(env, personKey);
        if (!profile) {
          return jsonResponse(
            { error: "Not found" },
            { status: 404, extra: withRequestIdHeader(undefined, requestId) }
          );
        }
        return jsonResponse(profile, { extra: withRequestIdHeader(undefined, requestId) });
      }

      if (url.pathname === "/calendar") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        let month = url.searchParams.get("month");
        if (!month || !isValidMonthString(month)) {
          month = getLocalDate(Date.now(), timezone).substring(0, 7);
        }
        const person = url.searchParams.get("person") || undefined;
        await ensureReportsForMonth(env, month);
        const [reports, people] = await Promise.all([
          getReportsForMonth(env, month, person),
          getDistinctPeopleForMonth(env, month),
        ]);
        return htmlResponse(
          renderCalendar(month, reports, withSelectedPerson(people, person), person, nonce),
          { nonce, extra: withRequestIdHeader(undefined, requestId) }
        );
      }

      if (url.pathname === "/events") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "html", nonce, requestId);
        if (!gate.ok) return gate.response;
        let date = url.searchParams.get("date");
        if (!date || !isValidLocalDateString(date)) {
          date = getLocalDate(Date.now(), timezone);
        }
        const person = url.searchParams.get("person") || undefined;
        const [events, people] = await Promise.all([
          getEventsForDate(env, date, person),
          getDistinctPeopleForDate(env, date),
        ]);
        return htmlResponse(
          renderEventsLog(date, events, withSelectedPerson(people, person), person, nonce),
          { nonce, extra: withRequestIdHeader(undefined, requestId) }
        );
      }

      if (url.pathname === "/api/reports") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        let month = url.searchParams.get("month");
        if (!month || !isValidMonthString(month)) {
          month = getLocalDate(Date.now(), timezone).substring(0, 7);
        }
        const person = url.searchParams.get("person") || undefined;
        await ensureReportsForMonth(env, month);
        const reports = await getReportsForMonth(env, month, person);
        return jsonResponse(reports, { extra: withRequestIdHeader(undefined, requestId) });
      }

      if (url.pathname === "/api/events") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        let date = url.searchParams.get("date");
        if (!date || !isValidLocalDateString(date)) {
          date = getLocalDate(Date.now(), timezone);
        }
        const person = url.searchParams.get("person") || undefined;
        const events = await getEventsForDate(env, date, person);
        return jsonResponse(events, { extra: withRequestIdHeader(undefined, requestId) });
      }

      if (url.pathname === "/api/people") {
        const notGet = requireGet(request);
        if (notGet) return notGet;
        const gate = await requireAccessAuth(request, env, "json", nonce, requestId);
        if (!gate.ok) return gate.response;
        const people = await getPeopleDirectory(env);
        return jsonResponse(people, { extra: withRequestIdHeader(undefined, requestId) });
      }

      return textResponse("Not Found", {
        status: 404,
        extra: withRequestIdHeader(undefined, requestId),
      });
    },

    async scheduled(
      _controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ): Promise<void> {
      const timezone = env.TIMEZONE || DEFAULT_TIMEZONE;
      const now = Date.now();
      const yesterdayMs = now - 12 * 60 * 60 * 1000;
      const yesterdayStr = getLocalDate(yesterdayMs, timezone);

      console.log(`[Cron] Starting daily reporting & cleanup. Reporting date: ${yesterdayStr}`);

      ctx.waitUntil(
        (async () => {
          try {
            await generateDailyReport(env, yesterdayStr, { force: true });
            await setCronReportOk(env, yesterdayStr, Date.now());
            console.log(`[Cron] Daily report successfully generated for ${yesterdayStr}`);
          } catch (err) {
            const code = classifyDbError(err);
            console.error(`[Cron] Error generating daily report`, code);
            reportError(env, ctx, err, {
              component: "cron",
              path: "generateDailyReport",
              operation: "generateDailyReport",
              error_code: code,
            });
            await setCronError(env, code, "generateDailyReport").catch(() => undefined);
          }

          try {
            const cleanup = await runRetentionCleanup(env);
            await setCleanupOk(env, { ...cleanup });
            console.log(
              `[Cron] Retention cleanup completed: scrubbed n=${cleanup.scrubbedNotifications} f=${cleanup.scrubbedFaceEvents} v=${cleanup.scrubbedVehicleEvents}; deleted n=${cleanup.deletedNotifications} f=${cleanup.deletedFaceEvents} v=${cleanup.deletedVehicleEvents} r=${cleanup.deletedReports} s=${cleanup.deletedSessions}`
            );

            const fk = await env.DB.prepare(`PRAGMA foreign_key_check`).all();
            if ((fk.results || []).length === 0) {
              await setFkCheckOk(env);
            } else {
              await setCronError(env, "D1_FK_CHECK_FAILED", "foreign_key_check");
              console.error(
                `[Cron] foreign_key_check returned ${(fk.results || []).length} row(s)`
              );
            }
          } catch (err) {
            const code = classifyDbError(err);
            console.error(`[Cron] Error running retention cleanup`, code);
            reportError(env, ctx, err, {
              component: "cron",
              path: "runRetentionCleanup",
              operation: "runRetentionCleanup",
              error_code: code,
            });
            await setCronError(env, code, "runRetentionCleanup").catch(() => undefined);
          }
        })()
      );
    },
  }
);
