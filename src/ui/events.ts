import { FaceEvent } from "../types.js";
import { renderLayout } from "./layout.js";

/**
 * Renders the list of events for a single day in a beautiful table
 */
export function renderEventsLog(dateStr: string, events: FaceEvent[]): string {
  let rowsHtml = "";
  if (events.length === 0) {
    rowsHtml = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">No recognition events recorded for this date.</td></tr>`;
  } else {
    rowsHtml = events.map(e => {
      const timeStr = new Date(e.seen_at_ms).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      
      return `<tr>
        <td><span class="badge">${timeStr}</span></td>
        <td><strong>${e.person_name}</strong></td>
        <td><span class="badge badge-accent">${e.trigger_key}</span></td>
        <td><code>${e.camera_id}</code></td>
        <td><code>${e.event_id}</code></td>
        <td>${e.alarm_name}</td>
      </tr>`;
    }).join("");
  }

  const eventsHtml = `
    <style>
      .events-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }
      .events-title {
        font-family: var(--font-heading);
        font-size: 1.5rem;
        font-weight: 700;
      }
      .back-btn {
        background: var(--panel);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.2s ease;
      }
      .back-btn:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: var(--primary);
      }
    </style>

    <div class="events-header">
      <div class="events-title">Events for ${dateStr}</div>
      <a href="/calendar" class="back-btn">&larr; Back to Calendar</a>
    </div>

    <div class="glass-card table-container">
      <table>
        <thead>
          <tr>
            <th>Time (Local)</th>
            <th>Name</th>
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

  return renderLayout(`Events Log - ${dateStr}`, eventsHtml);
}
