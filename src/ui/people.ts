import { PersonDirectoryEntry, PersonProfile, PersonHeatmapDay } from "../types.js";
import { normalizeJpegBase64 } from "../webhook/image.js";
import { escapeHtml } from "./html.js";
import { renderLayout } from "./layout.js";

function formatImageSrc(imageBase64: string): string | undefined {
  const raw = normalizeJpegBase64(imageBase64);
  return raw ? `data:image/jpeg;base64,${raw}` : undefined;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function profileHref(personKey: string): string {
  return `/people/${encodeURIComponent(personKey)}`;
}

export function renderPeopleDirectory(people: PersonDirectoryEntry[]): string {
  const rows =
    people.length === 0
      ? `<tr><td colspan="4" class="empty-cell">No people recorded yet.</td></tr>`
      : people
          .map((p) => {
            const href = profileHref(p.person_key);
            return `<tr>
              <td><a href="${href}" class="row-link">${escapeHtml(p.person_name)}</a></td>
              <td><code class="muted-code-sm">${escapeHtml(p.person_key)}</code></td>
              <td>${formatDateTime(p.last_seen_ms)}</td>
              <td>${p.event_count}</td>
            </tr>`;
          })
          .join("");

  const body = `
    <div class="page-header">
      <h2>People</h2>
      <p>Profiles keyed by stable person identity from UniFi Protect.</p>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Last seen</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  return renderLayout("People", body);
}

function heatIntensity(intensity: number): number {
  return Math.max(0, Math.min(10, Math.round(intensity * 10)));
}

function renderHeatmap(heatmap: PersonHeatmapDay[], personName: string): string {
  const byDate = new Map(heatmap.map((d) => [d.local_date, d]));
  const maxHours = Math.max(
    0.25,
    ...heatmap.map((d) => d.observed_rounded_hours || d.observed_span_seconds / 3600)
  );

  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 11);
  start.setUTCDate(1);

  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const monthBlocks = months
    .map((monthStr) => {
      const [y, m] = monthStr.split("-").map(Number);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const cells: string[] = [];
      for (let i = 0; i < firstDow; i++) {
        cells.push(`<div class="heat-cell empty"></div>`);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
        const entry = byDate.get(dateStr);
        const hours = entry
          ? entry.observed_rounded_hours || entry.observed_span_seconds / 3600
          : 0;
        const intensity = entry ? Math.min(1, hours / maxHours) : 0;
        const title = entry ? `${dateStr}: ${hours.toFixed(2)}h observed` : `${dateStr}: no visits`;
        const href = `/events?date=${encodeURIComponent(dateStr)}&person=${encodeURIComponent(personName)}`;
        const dataI = entry ? heatIntensity(intensity) : 0;
        cells.push(
          entry
            ? `<a class="heat-cell" href="${href}" title="${escapeHtml(title)}" data-i="${dataI}"></a>`
            : `<a class="heat-cell" href="${href}" title="${escapeHtml(title)}" data-i="0"></a>`
        );
      }
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      return `<div class="heat-month"><div class="heat-month-label">${escapeHtml(label)}</div><div class="heat-grid">${cells.join("")}</div></div>`;
    })
    .join("");

  return `<div class="heat-wrap">${monthBlocks}</div>`;
}

export function renderPersonProfile(profile: PersonProfile): string {
  const maxCam = Math.max(1, ...profile.cameras.map((c) => c.event_count));
  const camerasHtml =
    profile.cameras.length === 0
      ? `<p class="text-muted">No camera data.</p>`
      : profile.cameras
          .map((c) => {
            const pct = Math.round((c.event_count / maxCam) * 100);
            return `<div class="cam-row">
              <code>${escapeHtml(c.camera_id)}</code>
              <svg class="cam-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                <rect width="${pct}" height="6" rx="3"></rect>
              </svg>
              <span class="cam-count">${c.event_count}</span>
            </div>`;
          })
          .join("");

  const thumbs = profile.recent_events
    .map((e) => {
      const src = e.image_base64 ? formatImageSrc(e.image_base64) : undefined;
      if (!src) return "";
      return `<a class="thumb" href="/events?date=${encodeURIComponent(e.local_date)}&person=${encodeURIComponent(profile.person_name)}" title="${escapeHtml(formatDateTime(e.seen_at_ms))}">
          <img src="${src}" alt="" loading="lazy" />
        </a>`;
    })
    .filter(Boolean)
    .slice(0, 12)
    .join("");

  const historyRows =
    profile.recent_events.length === 0
      ? `<tr><td colspan="4" class="empty-cell-sm">No recent events.</td></tr>`
      : profile.recent_events
          .map(
            (e) => `<tr>
              <td>${formatDateTime(e.seen_at_ms)}</td>
              <td><code class="muted-code">${escapeHtml(e.camera_id)}</code></td>
              <td><span class="badge">${escapeHtml(e.trigger_key)}</span></td>
              <td><a href="/events?date=${encodeURIComponent(e.local_date)}&person=${encodeURIComponent(profile.person_name)}">Day log</a></td>
            </tr>`
          )
          .join("");

  const body = `
    <a class="back-link" href="/people">← All people</a>
    <div class="profile-header">
      <h2>${escapeHtml(profile.person_name)}</h2>
      <p class="profile-meta">
        <code>${escapeHtml(profile.person_key)}</code>
        ${profile.person_id ? ` · ID <code>${escapeHtml(profile.person_id)}</code>` : ""}
      </p>
      <p class="profile-meta">
        First recorded ${formatDateTime(profile.first_seen_ms)} ·
        Last seen ${formatDateTime(profile.last_seen_ms)}
      </p>
    </div>

    <div class="summary-grid">
      <div class="card summary-card">
        <div class="label">Visits</div>
        <div class="value profile">${profile.visit_count}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Observed</div>
        <div class="value profile">${profile.observed_rounded_hours}h</div>
      </div>
      <div class="card summary-card">
        <div class="label">Typical arrival</div>
        <div class="value profile">${profile.typical_arrival_label || "—"}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Typical departure</div>
        <div class="value profile">${profile.typical_departure_label || "—"}</div>
      </div>
      <div class="card summary-card">
        <div class="label">Events</div>
        <div class="value profile">${profile.event_count}</div>
      </div>
    </div>

    <div class="section card">
      <h3>Most frequent cameras</h3>
      ${camerasHtml}
    </div>

    <div class="section card">
      <h3>Calendar heatmap <span class="text-muted-sm">(last 12 months · observed presence)</span></h3>
      ${renderHeatmap(profile.heatmap, profile.person_name)}
    </div>

    ${
      thumbs
        ? `<div class="section card">
            <h3>Recent thumbnails</h3>
            <div class="thumb-grid">${thumbs}</div>
          </div>`
        : ""
    }

    <div class="section card">
      <h3>Recent event history</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Camera</th>
              <th>Trigger</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    </div>
  `;

  return renderLayout(profile.person_name, body);
}

export function renderPersonNotFound(personKey: string): string {
  const body = `
    <div class="card card-centered">
      <h2>Person not found</h2>
      <p class="text-muted mb-1">No events for <code>${escapeHtml(personKey)}</code>.</p>
      <a href="/people" class="accent-link">← Back to people</a>
    </div>
  `;
  return renderLayout("Not found", body);
}
