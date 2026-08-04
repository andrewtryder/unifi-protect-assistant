import {
  PlateSummary,
  VehicleDirectoryEntry,
  VehicleEvent,
  VehicleProfile,
  PersonHeatmapDay,
} from "../types.js";
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

function profileHref(plateKey: string): string {
  return `/vehicles/${encodeURIComponent(plateKey)}`;
}

function displayPlate(plateText: string, plateKey: string): string {
  return plateText?.trim() || plateKey.replace(/^plate:/, "") || "unknown";
}

export function renderPlateFilter(
  plates: PlateSummary[],
  selectedPlateKey: string | undefined,
  basePath: string,
  extraParamName: string,
  extraParamValue: string
): string {
  const options = [
    `<option value=""${!selectedPlateKey ? " selected" : ""}>All plates</option>`,
    ...plates.map((p) => {
      const selected = selectedPlateKey && p.plate_key === selectedPlateKey ? " selected" : "";
      const label = `${escapeHtml(displayPlate(p.plate_text, p.plate_key))} (${p.event_count})`;
      return `<option value="${escapeHtml(p.plate_key)}"${selected}>${label}</option>`;
    }),
  ].join("");

  return `
    <div class="people-filter">
      <label for="plate-filter" class="people-filter-label">Plate</label>
      <select
        id="plate-filter"
        class="people-filter-select"
        data-base-path="${escapeHtml(basePath)}"
        data-extra-param="${escapeHtml(extraParamName)}"
        data-extra-value="${escapeHtml(extraParamValue)}"
      >
        ${options}
      </select>
    </div>
  `;
}

export function renderVehiclesDirectory(vehicles: VehicleDirectoryEntry[]): string {
  const rows =
    vehicles.length === 0
      ? `<tr><td colspan="4" class="empty-cell">No vehicles recorded yet.</td></tr>`
      : vehicles
          .map((v) => {
            const href = profileHref(v.plate_key);
            const label = displayPlate(v.plate_text, v.plate_key);
            return `<tr>
              <td><a href="${href}" class="row-link">${escapeHtml(label)}</a></td>
              <td><code class="muted-code-sm">${escapeHtml(v.plate_key)}</code></td>
              <td>${formatDateTime(v.last_seen_ms)}</td>
              <td>${v.event_count}</td>
            </tr>`;
          })
          .join("");

  const body = `
    <div class="page-header">
      <h2>Vehicles</h2>
      <p>Profiles keyed by license plate from UniFi Protect (alarm subset).</p>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
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

  return renderLayout("Vehicles", body);
}

function heatIntensity(intensity: number): number {
  return Math.max(0, Math.min(10, Math.round(intensity * 10)));
}

function renderHeatmap(heatmap: PersonHeatmapDay[], plateKey: string): string {
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
        const href = `/vehicle-events?date=${encodeURIComponent(dateStr)}&plate=${encodeURIComponent(plateKey)}`;
        const dataI = entry ? heatIntensity(intensity) : 0;
        cells.push(
          `<a class="heat-cell" href="${href}" title="${escapeHtml(title)}" data-i="${dataI}"></a>`
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

export function renderVehicleProfile(profile: VehicleProfile): string {
  const label = displayPlate(profile.plate_text, profile.plate_key);
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
      return `<a class="thumb" href="/vehicle-events?date=${encodeURIComponent(e.local_date)}&plate=${encodeURIComponent(profile.plate_key)}" title="${escapeHtml(formatDateTime(e.seen_at_ms))}">
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
              <td><a href="/vehicle-events?date=${encodeURIComponent(e.local_date)}&plate=${encodeURIComponent(profile.plate_key)}">Day log</a></td>
            </tr>`
          )
          .join("");

  const body = `
    <a class="back-link" href="/vehicles">← All vehicles</a>
    <div class="profile-header">
      <h2>${escapeHtml(label)}</h2>
      <p class="profile-meta">
        <code>${escapeHtml(profile.plate_key)}</code>
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
      ${renderHeatmap(profile.heatmap, profile.plate_key)}
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

  return renderLayout(label, body);
}

export function renderVehicleNotFound(plateKey: string): string {
  const body = `
    <div class="card card-centered">
      <h2>Vehicle not found</h2>
      <p class="text-muted mb-1">No events for <code>${escapeHtml(plateKey)}</code>.</p>
      <a href="/vehicles" class="accent-link">← Back to vehicles</a>
    </div>
  `;
  return renderLayout("Not found", body);
}

export function renderVehicleEventsLog(
  dateStr: string,
  events: VehicleEvent[],
  plates: PlateSummary[],
  selectedPlateKey?: string
): string {
  let rowsHtml: string;
  if (events.length === 0) {
    const emptyMessage = selectedPlateKey
      ? `No vehicle events for this plate on this date.`
      : "No vehicle events recorded for this date.";
    rowsHtml = `<tr><td colspan="6" class="empty-cell-lg">${emptyMessage}</td></tr>`;
  } else {
    rowsHtml = events
      .map((e) => {
        const timeStr = new Date(e.seen_at_ms).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        let imageCell = `<span class="no-image">&mdash;</span>`;
        if (e.image_base64) {
          const src = formatImageSrc(e.image_base64);
          if (src) {
            imageCell = `<a href="${src}" target="_blank" rel="noopener noreferrer" class="event-thumb-link">
          <img src="${src}" alt="Detection thumbnail" class="event-thumb" loading="lazy" />
        </a>`;
          }
        }

        const plateLabel = displayPlate(e.plate_text, e.plate_key);
        return `<tr>
        <td><span class="badge">${timeStr}</span></td>
        <td><a href="${profileHref(e.plate_key)}" class="row-link">${escapeHtml(plateLabel)}</a></td>
        <td>${imageCell}</td>
        <td><span class="badge badge-accent">${escapeHtml(e.trigger_key)}</span></td>
        <td><code>${escapeHtml(e.camera_id)}</code></td>
        <td><code>${escapeHtml(e.event_id)}</code></td>
      </tr>`;
      })
      .join("");
  }

  const plateQuery = selectedPlateKey ? `&plate=${encodeURIComponent(selectedPlateKey)}` : "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));

  const prevDate = new Date(dateObj);
  prevDate.setUTCDate(dateObj.getUTCDate() - 1);
  const prevDateStr = prevDate.toISOString().split("T")[0];
  const prevDayLink = `/vehicle-events?date=${prevDateStr}${plateQuery}`;

  const nextDate = new Date(dateObj);
  nextDate.setUTCDate(dateObj.getUTCDate() + 1);
  const nextDateStr = nextDate.toISOString().split("T")[0];
  const nextDayLink = `/vehicle-events?date=${nextDateStr}${plateQuery}`;

  const backLink = selectedPlateKey
    ? `/vehicles/${encodeURIComponent(selectedPlateKey)}`
    : "/vehicles";

  const eventsHtml = `
    <div class="events-header">
      <div class="events-title-container">
        <a href="${prevDayLink}" class="nav-btn" title="Previous Day">&larr;</a>
        <div class="events-title">Vehicles for ${dateStr}</div>
        <a href="${nextDayLink}" class="nav-btn" title="Next Day">&rarr;</a>
      </div>
      <div class="events-header-controls">
        <div class="date-filter">
          <label for="date-select" class="date-filter-label">Date</label>
          <input type="date" id="date-select" class="date-filter-input" value="${dateStr}" />
        </div>
        ${renderPlateFilter(plates, selectedPlateKey, "/vehicle-events", "date", dateStr)}
        <a href="${backLink}" class="back-btn">&larr; Vehicles</a>
      </div>
    </div>

    <div class="card table-container">
      <table>
        <thead>
          <tr>
            <th>Time (Local)</th>
            <th>Plate</th>
            <th>Image</th>
            <th>Trigger</th>
            <th>Camera ID</th>
            <th>Event ID</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;

  const titleSuffix = selectedPlateKey ? ` - ${selectedPlateKey}` : "";
  return renderLayout(`Vehicle events - ${dateStr}${titleSuffix}`, eventsHtml, {
    eventsDate: dateStr,
  });
}
