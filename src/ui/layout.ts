import { escapeHtml } from "./html.js";

export function renderLayout(
  title: string,
  bodyContent: string,
  options?: {
    selectedPerson?: string;
    calendarMonth?: string;
    eventsDate?: string;
    scripts?: string[];
  }
): string {
  const personParam = options?.selectedPerson
    ? `?person=${encodeURIComponent(options.selectedPerson)}`
    : "";

  const calendarHref = options?.calendarMonth
    ? `/calendar?month=${options.calendarMonth}${options.selectedPerson ? `&person=${encodeURIComponent(options.selectedPerson)}` : ""}`
    : `/calendar${personParam}`;

  const eventsHref = options?.eventsDate
    ? `/events?date=${options.eventsDate}${options.selectedPerson ? `&person=${encodeURIComponent(options.selectedPerson)}` : ""}`
    : `/events${personParam}`;

  const extraScripts = (options?.scripts || [])
    .map((src) => `<script defer src="${escapeHtml(src)}"></script>`)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | UniFi Protect Assistant</title>
  <link rel="stylesheet" href="/assets/app.css">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <script defer src="/assets/app.js"></script>
  ${extraScripts}
</head>
<body>
  <header>
    <a href="/" class="brand">
      <span class="brand-mark"></span>
      <h1>UniFi Protect Assistant</h1>
    </a>
    <nav>
      <a href="/today" id="nav-today">Today</a>
      <a href="/people" id="nav-people">People</a>
      <a href="${calendarHref}" id="nav-calendar">Calendar</a>
      <a href="${eventsHref}" id="nav-events">Events Log</a>
      <a href="/health" id="nav-health">Health</a>
      <a href="/cdn-cgi/access/logout" class="sign-out" id="sign-out">Sign out</a>
    </nav>
  </header>

  <main>
    ${bodyContent}
  </main>

  <footer>
    <p>UniFi Protect Assistant &copy; 2026. Data local to America/New_York.</p>
  </footer>
</body>
</html>`;
}
