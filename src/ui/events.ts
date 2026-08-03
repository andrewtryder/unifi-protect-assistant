import { FaceEvent, PersonSummary } from "../types.js";
import { normalizeJpegBase64 } from "../webhook/image.js";
import { escapeHtml } from "./html.js";
import { renderLayout } from "./layout.js";
import { renderPeopleFilter, peopleFilterStyles } from "./peopleFilter.js";

function formatImageSrc(imageBase64: string): string | undefined {
  const raw = normalizeJpegBase64(imageBase64);
  return raw ? `data:image/jpeg;base64,${raw}` : undefined;
}

/**
 * Renders the list of events for a single day in a beautiful table
 */
export function renderEventsLog(
  dateStr: string,
  events: FaceEvent[],
  people: PersonSummary[],
  selectedPerson?: string,
  nonce?: string
): string {
  let rowsHtml: string;
  if (events.length === 0) {
    const emptyMessage = selectedPerson
      ? `No recognition events for ${escapeHtml(selectedPerson)} on this date.`
      : "No recognition events recorded for this date.";
    rowsHtml = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">${emptyMessage}</td></tr>`;
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

        return `<tr>
        <td><span class="badge">${timeStr}</span></td>
        <td><strong>${escapeHtml(e.person_name)}</strong></td>
        <td>${imageCell}</td>
        <td><span class="badge badge-accent">${escapeHtml(e.trigger_key)}</span></td>
        <td><code>${escapeHtml(e.camera_id)}</code></td>
        <td><code>${escapeHtml(e.event_id)}</code></td>
        <td>${escapeHtml(e.alarm_name)}</td>
      </tr>`;
      })
      .join("");
  }

  const personQuery = selectedPerson ? `&person=${encodeURIComponent(selectedPerson)}` : "";
  const calendarMonth = dateStr.substring(0, 7);
  const backLink = `/calendar?month=${calendarMonth}${personQuery}`;

  // Timezone-safe date arithmetic using UTC
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));

  const prevDate = new Date(dateObj);
  prevDate.setUTCDate(dateObj.getUTCDate() - 1);
  const prevDateStr = prevDate.toISOString().split("T")[0];
  const prevDayLink = `/events?date=${prevDateStr}${personQuery}`;

  const nextDate = new Date(dateObj);
  nextDate.setUTCDate(dateObj.getUTCDate() + 1);
  const nextDateStr = nextDate.toISOString().split("T")[0];
  const nextDayLink = `/events?date=${nextDateStr}${personQuery}`;

  const eventsHtml = `
    <style>
      ${peopleFilterStyles}
      .events-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .events-title-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .events-title {
        font-family: var(--font);
        font-size: 1.5rem;
        font-weight: 700;
      }
      .events-header-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .back-btn, .nav-btn {
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }
      .nav-btn {
        padding: 0.5rem 0.75rem;
      }
      .back-btn:hover, .nav-btn:hover {
        background: var(--surface-2);
        border-color: var(--accent);
      }
      .date-filter {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .date-filter-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .date-filter-input {
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        font-family: var(--font);
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        color-scheme: dark;
      }
      .date-filter-input:hover {
        border-color: var(--border-strong);
      }
      .date-filter-input:focus {
        border-color: var(--accent);
        outline: none;
      }
      .event-thumb-link {
        display: inline-block;
        line-height: 0;
      }
      .event-thumb {
        width: 44px;
        height: 44px;
        object-fit: cover;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        transition: border-color 0.15s ease;
      }
      .event-thumb:hover {
        border-color: var(--accent);
      }
      .no-image {
        color: var(--text-muted);
      }
    </style>

    <div class="events-header">
      <div class="events-title-container">
        <a href="${prevDayLink}" class="nav-btn" title="Previous Day">&larr;</a>
        <div class="events-title">Events for ${dateStr}</div>
        <a href="${nextDayLink}" class="nav-btn" title="Next Day">&rarr;</a>
      </div>
      <div class="events-header-controls">
        <div class="date-filter">
          <label for="date-select" class="date-filter-label">Date</label>
          <input type="date" id="date-select" class="date-filter-input" value="${dateStr}" onchange="onDateFilterChange(this)" />
        </div>
        ${renderPeopleFilter(people, selectedPerson, "/events", "date", dateStr)}
        <a href="${backLink}" class="back-btn">&larr; Back to Calendar</a>
      </div>
    </div>

    <script>
      function onDateFilterChange(input) {
        const params = new URLSearchParams(window.location.search);
        if (input.value) {
          params.set("date", input.value);
        } else {
          params.delete("date");
        }
        window.location.href = window.location.pathname + "?" + params.toString();
      }
    </script>

    <div class="card table-container">
      <table>
        <thead>
          <tr>
            <th>Time (Local)</th>
            <th>Name</th>
            <th>Image</th>
            <th>Trigger Key</th>
            <th>Camera ID</th>
            <th>Event ID</th>
            <th>Alarm Name</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;

  const titleSuffix = selectedPerson ? ` - ${selectedPerson}` : "";
  return renderLayout(`Events Log - ${dateStr}${titleSuffix}`, eventsHtml, {
    selectedPerson,
    eventsDate: dateStr,
    calendarMonth,
    nonce,
  });
}
