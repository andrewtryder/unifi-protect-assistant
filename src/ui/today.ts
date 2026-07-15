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
    return `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem 1rem;">No one seen yet today.</td></tr>`;
  }
  return snapshot.people
    .map((p) => {
      const statusClass = p.status === "present" ? "badge-accent" : "badge";
      const statusLabel = p.status === "present" ? "Present" : "Away";
      const eventsHref = `/people/${encodeURIComponent(p.person_key)}`;
      return `<tr>
        <td><a href="${eventsHref}" style="color:inherit;text-decoration:none;font-weight:600;">${escapeHtml(p.person_name)}</a></td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td>${formatTime(p.first_seen_ms)}</td>
        <td>${formatTime(p.last_seen_ms)}</td>
        <td><code style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(p.last_camera_id)}</code></td>
        <td>${p.observed_rounded_hours}h <span style="color:var(--text-muted);font-size:0.8rem;">(${p.session_count} sess)</span></td>
        <td>${p.sighting_count}</td>
      </tr>`;
    })
    .join("");
}

function streamRowsHtml(snapshot: TodaySnapshot): string {
  if (snapshot.recent_events.length === 0) {
    return `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem 1rem;">No events yet today.</td></tr>`;
  }
  return snapshot.recent_events
    .map(
      (e) => `<tr>
        <td>${formatTime(e.seen_at_ms)}</td>
        <td>${escapeHtml(e.person_name)}</td>
        <td><code style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(e.camera_id)}</code></td>
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
    <style>
      .today-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
      }
      .today-header h2 {
        font-family: var(--font);
        font-size: 1.75rem;
        font-weight: 700;
      }
      .today-meta {
        color: var(--text-muted);
        font-size: 0.85rem;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .summary-card {
        padding: 1.1rem 1.2rem;
      }
      .summary-card .label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        font-weight: 600;
        margin-bottom: 0.35rem;
      }
      .summary-card .value {
        font-family: var(--font);
        font-size: 1.6rem;
        font-weight: 700;
      }
      .summary-card .sub {
        margin-top: 0.25rem;
        font-size: 0.75rem;
        color: var(--text-muted);
      }
      .today-section {
        margin-bottom: 1.5rem;
      }
      .today-section h3 {
        font-family: var(--font);
        font-size: 1.05rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
      }
      .poll-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--success);
        margin-right: 0.4rem;
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
    </style>

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
        <div class="label">Unknown faces</div>
        <div class="value" data-field="unknown_face_count">${snapshot.unknown_face_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Events (1h)</div>
        <div class="value" data-field="events_last_hour">${snapshot.events_last_hour}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Webhook</div>
        <div class="value" style="font-size:1.1rem;"><span class="badge ${healthClass}" data-field="webhook_status">${healthLabel}</span></div>
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

    <script type="application/json" id="today-bootstrap">${JSON.stringify(snapshot).replace(/</g, "\\u003c")}</script>
    <script>
      (function () {
        const tz = 'America/New_York';
        function formatTime(ms) {
          return new Date(ms).toLocaleTimeString('en-US', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
          });
        }
        function formatAge(ms, nowMs) {
          if (ms == null) return 'never';
          const seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
          if (seconds < 60) return seconds + 's ago';
          const minutes = Math.floor(seconds / 60);
          if (minutes < 60) return minutes + 'm ago';
          const hours = Math.floor(minutes / 60);
          if (hours < 48) return hours + 'h ago';
          return Math.floor(hours / 24) + 'd ago';
        }
        function escapeHtml(s) {
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }
        function peopleHtml(snapshot) {
          if (!snapshot.people.length) {
            return '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem 1rem;">No one seen yet today.</td></tr>';
          }
          return snapshot.people.map(function (p) {
            const statusClass = p.status === 'present' ? 'badge-accent' : 'badge';
            const statusLabel = p.status === 'present' ? 'Present' : 'Away';
            const href = '/people/' + encodeURIComponent(p.person_key);
            return '<tr>' +
              '<td><a href="' + href + '" style="color:inherit;text-decoration:none;font-weight:600;">' + escapeHtml(p.person_name) + '</a></td>' +
              '<td><span class="badge ' + statusClass + '">' + statusLabel + '</span></td>' +
              '<td>' + formatTime(p.first_seen_ms) + '</td>' +
              '<td>' + formatTime(p.last_seen_ms) + '</td>' +
              '<td><code style="font-size:0.8rem;color:var(--text-muted);">' + escapeHtml(p.last_camera_id) + '</code></td>' +
              '<td>' + p.observed_rounded_hours + 'h <span style="color:var(--text-muted);font-size:0.8rem;">(' + p.session_count + ' sess)</span></td>' +
              '<td>' + p.sighting_count + '</td>' +
              '</tr>';
          }).join('');
        }
        function streamHtml(snapshot) {
          if (!snapshot.recent_events.length) {
            return '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem 1rem;">No events yet today.</td></tr>';
          }
          return snapshot.recent_events.map(function (e) {
            return '<tr>' +
              '<td>' + formatTime(e.seen_at_ms) + '</td>' +
              '<td>' + escapeHtml(e.person_name) + '</td>' +
              '<td><code style="font-size:0.8rem;color:var(--text-muted);">' + escapeHtml(e.camera_id) + '</code></td>' +
              '<td><span class="badge">' + escapeHtml(e.trigger_key) + '</span></td>' +
              '</tr>';
          }).join('');
        }
        function applySnapshot(snapshot) {
          document.querySelector('[data-field="present_count"]').textContent = snapshot.present_count;
          document.querySelector('[data-field="seen_today_count"]').textContent = snapshot.seen_today_count;
          document.querySelector('[data-field="unknown_face_count"]').textContent = snapshot.unknown_face_count;
          document.querySelector('[data-field="events_last_hour"]').textContent = snapshot.events_last_hour;
          const statusEl = document.querySelector('[data-field="webhook_status"]');
          statusEl.textContent = snapshot.webhook.healthy ? 'Healthy' : 'Stale / quiet';
          statusEl.className = 'badge ' + (snapshot.webhook.healthy ? 'badge-accent' : 'badge');
          document.querySelector('[data-field="webhook_sub"]').textContent =
            'Last ' + formatAge(snapshot.webhook.last_received_at_ms, snapshot.generated_at_ms) +
            ' · ' + snapshot.webhook.count_last_hour + ' in last hour';
          document.getElementById('people-tbody').innerHTML = peopleHtml(snapshot);
          document.getElementById('stream-tbody').innerHTML = streamHtml(snapshot);
          document.getElementById('today-date').textContent = snapshot.local_date + ' · America/New_York';
          document.getElementById('updated-at').textContent = formatTime(snapshot.generated_at_ms);
        }
        async function poll() {
          try {
            const res = await fetch('/api/today', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            applySnapshot(data);
          } catch (e) { /* keep last good frame */ }
        }
        setInterval(poll, 15000);
      })();
    </script>
  `;

  return renderLayout(`Today — ${snapshot.local_date}`, body, {
    eventsDate: snapshot.local_date,
  });
}
