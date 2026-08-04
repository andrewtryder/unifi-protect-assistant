import { DailyReport, PersonSummary } from "../types.js";
import { escapeHtml } from "./html.js";
import { renderLayout } from "./layout.js";
import { renderPeopleFilter } from "./peopleFilter.js";

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

  const firstDayIndex = new Date(year, month - 1, 1).getDay();
  const totalDays = new Date(year, month, 0).getDate();

  const prevMonthDate = new Date(year, month - 2, 1);
  const nextMonthDate = new Date(year, month, 1);

  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const personQuery = selectedPerson ? `&person=${encodeURIComponent(selectedPerson)}` : "";
  const prevLink = `/calendar?month=${prevMonthStr}${personQuery}`;
  const nextLink = `/calendar?month=${nextMonthStr}${personQuery}`;

  const reportsByDay = new Map<number, DailyReport[]>();
  for (const report of reports) {
    const day = Number(report.local_date.split("-")[2]);
    if (!reportsByDay.has(day)) {
      reportsByDay.set(day, []);
    }
    reportsByDay.get(day)!.push(report);
  }

  const cells: string[] = [];

  for (let i = 0; i < firstDayIndex; i++) {
    cells.push(`<div class="day empty"></div>`);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dayReports = reportsByDay.get(day) || [];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayLink = `/events?date=${dateStr}${personQuery}`;

    let reportsHtml = "";
    if (dayReports.length > 0) {
      reportsHtml = dayReports
        .map((r) => {
          const firstTime = new Date(r.first_seen_ms).toLocaleTimeString("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const lastTime = new Date(r.last_seen_ms).toLocaleTimeString("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const observedHours = r.observed_rounded_hours ?? r.rounded_span_hours;
          const sessions =
            r.session_count != null
              ? `, ${r.session_count} session${r.session_count === 1 ? "" : "s"}`
              : "";
          const wallHint =
            r.observed_rounded_hours != null ? `; wall ${r.rounded_span_hours}h first–last` : "";
          const name = escapeHtml(r.person_name);
          const tooltip = escapeHtml(
            `${r.person_name}: ${firstTime}–${lastTime}, observed ${observedHours}h${sessions}${wallHint}`
          );
          return `<div class="person-tag" title="${tooltip}">
          <span class="dot"></span>${name} <strong>${observedHours}h</strong>
        </div>`;
        })
        .join("");
    }

    cells.push(`
      <a href="${dayLink}" class="day-cell-link">
        <div class="day-cell ${dayReports.length > 0 ? "active-day" : ""}">
          <span class="day-number">${day}</span>
          <div class="day-content">${reportsHtml}</div>
        </div>
      </a>
    `);
  }

  const calendarHtml = `
    <div class="calendar-header">
      <a href="${prevLink}" class="nav-btn">&larr; Prev</a>
      <div class="month-title">${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
      <div class="calendar-header-controls">
        ${renderPeopleFilter(people, selectedPerson, "/calendar", "month", monthStr)}
        <a href="${nextLink}" class="nav-btn">Next &rarr;</a>
      </div>
    </div>
    
    <div class="calendar-grid card">
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
