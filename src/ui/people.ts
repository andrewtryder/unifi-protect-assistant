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
      ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem;">No people recorded yet.</td></tr>`
      : people
          .map((p) => {
            const href = profileHref(p.person_key);
            return `<tr>
              <td><a href="${href}" style="color:inherit;text-decoration:none;font-weight:600;">${escapeHtml(p.person_name)}</a></td>
              <td><code style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(p.person_key)}</code></td>
              <td>${formatDateTime(p.last_seen_ms)}</td>
              <td>${p.event_count}</td>
            </tr>`;
          })
          .join("");

  const body = `
    <style>
      .page-header { margin-bottom: 1.5rem; }
      .page-header h2 {
        font-family: var(--font-heading);
        font-size: 1.75rem;
        font-weight: 700;
      }
      .page-header p { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.35rem; }
    </style>
    <div class="page-header">
      <h2>People</h2>
      <p>Profiles keyed by stable person identity from UniFi Protect.</p>
    </div>
    <div class="glass-card">
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

function renderHeatmap(heatmap: PersonHeatmapDay[], personName: string): string {
  const byDate = new Map(heatmap.map((d) => [d.local_date, d]));
  const maxHours = Math.max(
    0.25,
    ...heatmap.map((d) => d.observed_rounded_hours || d.observed_span_seconds / 3600)
  );

  // Build last 12 months ending today (UTC calendar approx for grid)
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 11);
  start.setUTCDate(1);

  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    );
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
        const title = entry
          ? `${dateStr}: ${hours.toFixed(2)}h observed`
          : `${dateStr}: no visits`;
        const href = `/events?date=${encodeURIComponent(dateStr)}&person=${encodeURIComponent(personName)}`;
        cells.push(
          `<a class="heat-cell" href="${href}" title="${escapeHtml(title)}" style="--heat:${intensity.toFixed(3)}"></a>`
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
      ? `<p style="color:var(--text-muted);">No camera data.</p>`
      : profile.cameras
          .map((c) => {
            const pct = Math.round((c.event_count / maxCam) * 100);
            return `<div class="cam-row">
              <code>${escapeHtml(c.camera_id)}</code>
              <div class="cam-bar"><span style="width:${pct}%"></span></div>
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
      ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No recent events.</td></tr>`
      : profile.recent_events
          .map(
            (e) => `<tr>
              <td>${formatDateTime(e.seen_at_ms)}</td>
              <td><code style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(e.camera_id)}</code></td>
              <td><span class="badge">${escapeHtml(e.trigger_key)}</span></td>
              <td><a href="/events?date=${encodeURIComponent(e.local_date)}&person=${encodeURIComponent(profile.person_name)}">Day log</a></td>
            </tr>`
          )
          .join("");

  const body = `
    <style>
      .profile-header { margin-bottom: 1.5rem; }
      .profile-header h2 {
        font-family: var(--font-heading);
        font-size: 1.75rem;
        font-weight: 700;
      }
      .profile-meta { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.4rem; }
      .profile-meta code { font-size: 0.8rem; }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .summary-card { padding: 1.1rem 1.2rem; }
      .summary-card .label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        font-weight: 600;
        margin-bottom: 0.35rem;
      }
      .summary-card .value {
        font-family: var(--font-heading);
        font-size: 1.35rem;
        font-weight: 700;
      }
      .section { margin-bottom: 1.5rem; }
      .section h3 {
        font-family: var(--font-heading);
        font-size: 1.05rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
      }
      .cam-row {
        display: grid;
        grid-template-columns: minmax(80px, 1fr) 3fr auto;
        gap: 0.75rem;
        align-items: center;
        margin-bottom: 0.5rem;
        font-size: 0.85rem;
      }
      .cam-bar {
        height: 8px;
        background: rgba(255,255,255,0.06);
        border-radius: 4px;
        overflow: hidden;
      }
      .cam-bar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #6366f1, #10b981);
        border-radius: 4px;
      }
      .cam-count { color: var(--text-muted); }
      .heat-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 1.25rem;
      }
      .heat-month-label {
        font-size: 0.75rem;
        color: var(--text-muted);
        margin-bottom: 0.4rem;
      }
      .heat-grid {
        display: grid;
        grid-template-columns: repeat(7, 12px);
        gap: 3px;
      }
      .heat-cell {
        width: 12px;
        height: 12px;
        border-radius: 2px;
        background: rgba(16, 185, 129, calc(0.12 + var(--heat, 0) * 0.88));
        border: 1px solid rgba(255,255,255,0.04);
        display: block;
      }
      .heat-cell.empty {
        background: transparent;
        border-color: transparent;
        pointer-events: none;
      }
      .thumb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 0.75rem;
      }
      .thumb {
        aspect-ratio: 1;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--border);
        display: block;
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .back-link {
        display: inline-block;
        margin-bottom: 1rem;
        color: var(--text-muted);
        text-decoration: none;
        font-size: 0.9rem;
      }
      .back-link:hover { color: var(--text); }
    </style>

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
      <div class="glass-card summary-card">
        <div class="label">Visits</div>
        <div class="value">${profile.visit_count}</div>
      </div>
      <div class="glass-card summary-card">
        <div class="label">Observed</div>
        <div class="value">${profile.observed_rounded_hours}h</div>
      </div>
      <div class="glass-card summary-card">
        <div class="label">Typical arrival</div>
        <div class="value">${profile.typical_arrival_label || "—"}</div>
      </div>
      <div class="glass-card summary-card">
        <div class="label">Typical departure</div>
        <div class="value">${profile.typical_departure_label || "—"}</div>
      </div>
      <div class="glass-card summary-card">
        <div class="label">Events</div>
        <div class="value">${profile.event_count}</div>
      </div>
    </div>

    <div class="section glass-card">
      <h3>Most frequent cameras</h3>
      ${camerasHtml}
    </div>

    <div class="section glass-card">
      <h3>Calendar heatmap <span style="color:var(--text-muted);font-weight:400;font-size:0.85rem;">(last 12 months · observed presence)</span></h3>
      ${renderHeatmap(profile.heatmap, profile.person_name)}
    </div>

    ${
      thumbs
        ? `<div class="section glass-card">
            <h3>Recent thumbnails</h3>
            <div class="thumb-grid">${thumbs}</div>
          </div>`
        : ""
    }

    <div class="section glass-card">
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
    <div class="glass-card" style="padding:2rem;text-align:center;">
      <h2 style="font-family:var(--font-heading);margin-bottom:0.75rem;">Person not found</h2>
      <p style="color:var(--text-muted);margin-bottom:1.25rem;">No events for <code>${escapeHtml(personKey)}</code>.</p>
      <a href="/people" style="color:var(--primary);">← Back to people</a>
    </div>
  `;
  return renderLayout("Not found", body);
}
