import { TodaySnapshot } from "../types.js";
import { escapeHtml } from "./html.js";
import { renderLayout } from "./layout.js";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatAge(ms: number | null, nowMs: number): string {
  if (ms == null) return "never";
  const seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function peopleRowsHtml(snapshot: TodaySnapshot): string {
  if (snapshot.people.length === 0) {
    return `<tr><td colspan="7" class="empty-cell">No one seen yet today.</td></tr>`;
  }
  return snapshot.people
    .map((p) => {
      const statusClass = p.status === "present" ? "badge-accent" : "badge";
      const statusLabel = p.status === "present" ? "Present" : "Away";
      const eventsHref = `/people/${encodeURIComponent(p.person_key)}`;
      return `<tr>
        <td><a href="${eventsHref}" class="row-link">${escapeHtml(p.person_name)}</a></td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td>${formatTime(p.first_seen_ms)}</td>
        <td>${formatTime(p.last_seen_ms)}</td>
        <td><code class="muted-code">${escapeHtml(p.last_camera_id)}</code></td>
        <td>${p.observed_rounded_hours}h <span class="muted-sm">(${p.session_count} sess)</span></td>
        <td>${p.sighting_count}</td>
      </tr>`;
    })
    .join("");
}

function vehiclesRowsHtml(snapshot: TodaySnapshot): string {
  const vehicles = snapshot.vehicles || [];
  if (vehicles.length === 0) {
    return `<tr><td colspan="7" class="empty-cell">No vehicles seen yet today.</td></tr>`;
  }
  return vehicles
    .map((v) => {
      const statusClass = v.status === "present" ? "badge-accent" : "badge";
      const statusLabel = v.status === "present" ? "Present" : "Away";
      const href = `/vehicles/${encodeURIComponent(v.plate_key)}`;
      const label = v.plate_text || v.plate_key.replace(/^plate:/, "");
      return `<tr>
        <td><a href="${href}" class="row-link">${escapeHtml(label)}</a></td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td>${formatTime(v.first_seen_ms)}</td>
        <td>${formatTime(v.last_seen_ms)}</td>
        <td><code class="muted-code">${escapeHtml(v.last_camera_id)}</code></td>
        <td>${v.observed_rounded_hours}h <span class="muted-sm">(${v.session_count} sess)</span></td>
        <td>${v.sighting_count}</td>
      </tr>`;
    })
    .join("");
}

function streamRowsHtml(snapshot: TodaySnapshot): string {
  if (snapshot.recent_events.length === 0) {
    return `<tr><td colspan="4" class="empty-cell">No events yet today.</td></tr>`;
  }
  return snapshot.recent_events
    .map(
      (e) => `<tr>
        <td>${formatTime(e.seen_at_ms)}</td>
        <td>${escapeHtml(e.person_name)}</td>
        <td><code class="muted-code">${escapeHtml(e.camera_id)}</code></td>
        <td><span class="badge">${escapeHtml(e.trigger_key)}</span></td>
      </tr>`
    )
    .join("");
}

export function renderTodayDashboard(snapshot: TodaySnapshot): string {
  const nowMs = snapshot.generated_at_ms;
  const healthClass = snapshot.webhook.healthy ? "badge-accent" : "badge";
  const healthLabel = snapshot.webhook.healthy ? "Healthy" : "Stale / quiet";

  const body = `
    <div class="today-header">
      <div>
        <h2>Today</h2>
        <p class="today-meta" id="today-date">${escapeHtml(snapshot.local_date)} · America/New_York</p>
      </div>
      <p class="today-meta"><span class="poll-dot"></span>Live · updates every 15s · <span id="updated-at">just now</span></p>
    </div>

    <div class="summary-grid" id="summary-grid">
      <div class="card summary-card">
        <div class="label">Present now</div>
        <div class="value" data-field="present_count">${snapshot.present_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Seen today</div>
        <div class="value" data-field="seen_today_count">${snapshot.seen_today_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Vehicles present</div>
        <div class="value" data-field="vehicles_present_count">${snapshot.vehicles_present_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Vehicles today</div>
        <div class="value" data-field="vehicles_seen_today_count">${snapshot.vehicles_seen_today_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Unknown faces</div>
        <div class="value" data-field="unknown_face_count">${snapshot.unknown_face_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Events (1h)</div>
        <div class="value" data-field="events_last_hour">${snapshot.events_last_hour}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Webhook</div>
        <div class="value value-md"><span class="badge ${healthClass}" data-field="webhook_status">${healthLabel}</span></div>
        <div class="sub" data-field="webhook_sub">Last ${formatAge(snapshot.webhook.last_received_at_ms, nowMs)} · ${snapshot.webhook.count_last_hour} in last hour</div>
      </div>
    </div>

    <div class="today-section card">
      <h3>People today</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>First seen</th>
              <th>Most recent</th>
              <th>Last camera</th>
              <th>Observed</th>
              <th>Sightings</th>
            </tr>
          </thead>
          <tbody id="people-tbody">
            ${peopleRowsHtml(snapshot)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="today-section card">
      <h3>Vehicles today</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Status</th>
              <th>First seen</th>
              <th>Most recent</th>
              <th>Last camera</th>
              <th>Observed</th>
              <th>Sightings</th>
            </tr>
          </thead>
          <tbody id="vehicles-tbody">
            ${vehiclesRowsHtml(snapshot)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="today-section card">
      <h3>Live event stream</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Name</th>
              <th>Camera</th>
              <th>Trigger</th>
            </tr>
          </thead>
          <tbody id="stream-tbody">
            ${streamRowsHtml(snapshot)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  return renderLayout(`Today — ${snapshot.local_date}`, body, {
    eventsDate: snapshot.local_date,
    scripts: ["/assets/today.js"],
  });
}
