import { DailyReport, PersonSummary } from "../types.js";
import { renderLayout } from "./layout.js";
import { renderPeopleFilter, peopleFilterStyles } from "./peopleFilter.js";

/**
 * Helper to build calendar grid HTML
 */
export function renderCalendar(
  monthStr: string,
  reports: DailyReport[],
  people: PersonSummary[],
  selectedPerson?: string
): string {
  const [year, month] = monthStr.split("-").map(Number);
  
  // Calculate calendar dates
  const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 = Sun
  const totalDays = new Date(year, month, 0).getDate();

  // Create date object for prev/next month links
  const prevMonthDate = new Date(year, month - 2, 1);
  const nextMonthDate = new Date(year, month, 1);

  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const personQuery = selectedPerson ? `&person=${encodeURIComponent(selectedPerson)}` : "";
  const prevLink = `/calendar?month=${prevMonthStr}${personQuery}`;
  const nextLink = `/calendar?month=${nextMonthStr}${personQuery}`;

  // Group reports by day
  const reportsByDay = new Map<number, DailyReport[]>();
  for (const report of reports) {
    const day = Number(report.local_date.split("-")[2]);
    if (!reportsByDay.has(day)) {
      reportsByDay.set(day, []);
    }
    reportsByDay.get(day)!.push(report);
  }

  // Create calendar body
  let cells: string[] = [];
  
  // Empty slots for previous month padding
  for (let i = 0; i < firstDayIndex; i++) {
    cells.push(`<div class="day empty"></div>`);
  }

  // Days of the month
  for (let day = 1; day <= totalDays; day++) {
    const dayReports = reportsByDay.get(day) || [];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayLink = `/events?date=${dateStr}${personQuery}`;
    
    let reportsHtml = "";
    if (dayReports.length > 0) {
      reportsHtml = dayReports.map(r => {
        const firstTime = new Date(r.first_seen_ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        const lastTime = new Date(r.last_seen_ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        const tooltip = `${r.person_name}: ${firstTime} - ${lastTime} (${r.rounded_span_hours} hrs)`;
        return `<div class="person-tag" title="${tooltip}">
          <span class="dot"></span>${r.person_name} <strong>${r.rounded_span_hours}h</strong>
        </div>`;
      }).join("");
    }

    cells.push(`
      <a href="${dayLink}" class="day-cell-link">
        <div class="day-cell ${dayReports.length > 0 ? 'active-day' : ''}">
          <span class="day-number">${day}</span>
          <div class="day-content">${reportsHtml}</div>
        </div>
      </a>
    `);
  }

  const calendarStyles = `
    <style>
      ${peopleFilterStyles}
      .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .calendar-header-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .month-title {
        font-family: var(--font-heading);
        font-size: 1.5rem;
        font-weight: 700;
      }
      .nav-btn {
        background: var(--panel);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.2s ease;
      }
      .nav-btn:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: var(--primary);
      }
      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 8px;
      }
      .weekday {
        text-align: center;
        font-weight: 600;
        font-size: 0.8rem;
        color: var(--text-muted);
        text-transform: uppercase;
        padding: 0.5rem;
      }
      .day-cell-link {
        text-decoration: none;
        color: inherit;
      }
      .day-cell {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        aspect-ratio: 1.2;
        padding: 0.5rem;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        transition: all 0.2s ease;
        height: 100%;
        min-height: 80px;
      }
      .day-cell:hover {
        border-color: var(--primary);
        box-shadow: 0 0 12px var(--primary-glow);
        transform: translateY(-2px);
      }
      .day-number {
        font-weight: 700;
        font-size: 0.9rem;
        color: var(--text-muted);
      }
      .active-day .day-number {
        color: var(--text);
      }
      .day-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: auto;
        max-height: 70%;
        margin-top: 4px;
      }
      .person-tag {
        font-size: 0.7rem;
        background: rgba(99, 102, 241, 0.12);
        border: 1px solid rgba(99, 102, 241, 0.2);
        padding: 2px 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .person-tag .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--primary);
        display: inline-block;
      }
      .empty {
        background: transparent;
        border: none;
        pointer-events: none;
      }
      @media (max-width: 768px) {
        .calendar-grid {
          grid-template-columns: repeat(1, 1fr);
          gap: 12px;
        }
        .weekday {
          display: none;
        }
        .day-cell {
          aspect-ratio: auto;
          flex-direction: row;
          align-items: center;
          padding: 1rem;
        }
        .day-content {
          margin-top: 0;
          flex-direction: row;
          flex-wrap: wrap;
        }
      }
    </style>
  `;

  const calendarHtml = `
    ${calendarStyles}
    <div class="calendar-header">
      <a href="${prevLink}" class="nav-btn">&larr; Prev</a>
      <div class="month-title">${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
      <div class="calendar-header-controls">
        ${renderPeopleFilter(people, selectedPerson, "/calendar", "month", monthStr)}
        <a href="${nextLink}" class="nav-btn">Next &rarr;</a>
      </div>
    </div>
    
    <div class="calendar-grid glass-card">
      <div class="weekday">Sun</div>
      <div class="weekday">Mon</div>
      <div class="weekday">Tue</div>
      <div class="weekday">Wed</div>
      <div class="weekday">Thu</div>
      <div class="weekday">Fri</div>
      <div class="weekday">Sat</div>
      ${cells.join("")}
    </div>
  `;

  const titleSuffix = selectedPerson ? ` - ${selectedPerson}` : "";
  return renderLayout(`Calendar - ${monthStr}${titleSuffix}`, calendarHtml, {
    selectedPerson,
    calendarMonth: monthStr,
  });
}
