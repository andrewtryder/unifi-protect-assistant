import type { HealthSnapshot } from "../types.js";
import { escapeHtml } from "./html.js";
import { renderLayout } from "./layout.js";

function formatWhen(ms: number | null): string {
  if (ms == null) return "never";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatAge(ms: number | null, nowMs: number): string {
  if (ms == null) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function renderHealthPage(snapshot: HealthSnapshot): string {
  const now = snapshot.generated_at_ms;
  const healthClass = snapshot.webhook_healthy ? "badge-accent" : "badge";
  const healthLabel = snapshot.webhook_healthy ? "Healthy" : "Stale / quiet";
  const c = snapshot.today_counters;

  const warningsHtml =
    snapshot.config_warnings.length === 0
      ? `<p class="text-muted">No configuration warnings.</p>`
      : `<ul class="warn-list">${snapshot.config_warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join("")}</ul>`;

  const cleanupSummary = snapshot.last_cleanup_summary
    ? Object.entries(snapshot.last_cleanup_summary)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")
    : "—";

  const body = `
    <div class="page-header">
      <h2>Health</h2>
      <p>Diagnostics for ${escapeHtml(snapshot.local_date)} · America/New_York · snapshot ${formatWhen(now)}</p>
    </div>

    <div class="summary-grid wide">
      <div class="card summary-card">
        <div class="label">Webhook status</div>
        <div class="value health"><span class="badge ${healthClass}">${healthLabel}</span></div>
        <div class="sub">Last ${formatAge(snapshot.last_webhook_at_ms, now)}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Last webhook</div>
        <div class="value value-sm">${formatWhen(snapshot.last_webhook_at_ms)}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Last event</div>
        <div class="value value-sm">${formatWhen(snapshot.last_event_at_ms)}</div>
        <div class="sub">${formatAge(snapshot.last_event_at_ms, now)}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Events 1h / 24h</div>
        <div class="value health">${snapshot.events_last_hour} / ${snapshot.events_last_day}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Webhooks 1h / 24h</div>
        <div class="value health">${snapshot.webhooks_last_hour} / ${snapshot.webhooks_last_day}</div>
      </div>
    </div>

    <div class="section card">
      <h3>Today’s ingest counters <span class="text-muted-sm">(D1 · local day)</span></h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Rejected auth</th>
              <th>Invalid JSON</th>
              <th>Oversized body</th>
              <th>Ingested</th>
              <th>Faces attempted</th>
              <th>Faces inserted</th>
              <th>Face dupes</th>
              <th>Plates attempted</th>
              <th>Plates inserted</th>
              <th>Plate dupes</th>
              <th>Zero detections</th>
              <th>D1 failures</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${c.rejected_auth}</td>
              <td>${c.rejected_json}</td>
              <td>${c.rejected_body}</td>
              <td>${c.ingested_webhooks}</td>
              <td>${c.events_attempted}</td>
              <td>${c.events_inserted}</td>
              <td>${c.duplicates}</td>
              <td>${c.vehicles_attempted}</td>
              <td>${c.vehicles_inserted}</td>
              <td>${c.vehicle_duplicates}</td>
              <td>${c.zero_face_webhooks}</td>
              <td>${c.d1_failures}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="kv-note">Parsing failures = Invalid JSON. Zero detections means a valid payload stored with no face or plate events after filters. Counters are atomic D1 upserts.</p>
      ${
        snapshot.last_d1_error
          ? `<p class="error-box">Last D1 error (${formatWhen(snapshot.last_d1_error_at_ms)}): ${escapeHtml(snapshot.last_d1_error.code)} @ ${escapeHtml(snapshot.last_d1_error.operation)}</p>`
          : ""
      }
    </div>

    <div class="section card">
      <h3>Cron / maintenance</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Last report run</th>
              <th>Report date</th>
              <th>Last cleanup</th>
              <th>Cleanup summary</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${formatWhen(snapshot.last_cron_report_at_ms)}</td>
              <td>${snapshot.last_cron_report_date ? escapeHtml(snapshot.last_cron_report_date) : "—"}</td>
              <td>${formatWhen(snapshot.last_cleanup_at_ms)}</td>
              <td class="cell-wrap">${escapeHtml(cleanupSummary)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${
        snapshot.last_cron_error
          ? `<p class="error-box">Last cron error (${formatWhen(snapshot.last_cron_error.at_ms)}): ${escapeHtml(snapshot.last_cron_error.code)} @ ${escapeHtml(snapshot.last_cron_error.operation)}</p>`
          : ""
      }
      ${
        snapshot.cleanup_stale
          ? `<p class="error-box">Warning: retention cleanup is stale (no successful run within ~36h).</p>`
          : ""
      }
      ${
        snapshot.last_fk_check_at_ms != null
          ? `<p class="kv-note">Last FK integrity check: ${formatWhen(snapshot.last_fk_check_at_ms)} · ${snapshot.last_fk_check_ok ? "ok" : "failed"}</p>`
          : ""
      }
    </div>

    <div class="section card">
      <h3>Database usage <span class="text-muted-sm">(row counts)</span></h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>webhook_notifications</th>
              <th>face_events</th>
              <th>vehicle_events</th>
              <th>daily_person_reports</th>
              <th>presence_sessions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${snapshot.db_usage.webhook_notifications}</td>
              <td>${snapshot.db_usage.face_events}</td>
              <td>${snapshot.db_usage.vehicle_events}</td>
              <td>${snapshot.db_usage.daily_person_reports}</td>
              <td>${snapshot.db_usage.presence_sessions}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="kv-note">Byte size and storage quotas are visible in the Cloudflare D1 dashboard, not via the Worker API.</p>
    </div>

    <div class="section card">
      <h3>Cloudflare Access</h3>
      <p class="kv-note">
        Configured: ${snapshot.access.configured ? "yes" : "no"} ·
        Allowed identities: ${snapshot.access.allowlist_count}
        ${
          snapshot.access.last_jwt_failure_class
            ? ` · Last JWT failure class: ${escapeHtml(snapshot.access.last_jwt_failure_class)}`
            : ""
        }
      </p>
    </div>

    <div class="section card">
      <h3>Configuration warnings</h3>
      ${warningsHtml}
    </div>
  `;

  return renderLayout("Health", body);
}
