import { escapeHtml } from "./html.js";

export function renderLayout(
  title: string,
  bodyContent: string,
  options?: { selectedPerson?: string; calendarMonth?: string; eventsDate?: string; nonce?: string }
): string {
  const nonceAttr = options?.nonce ? ` nonce="${options.nonce}"` : "";

  const personParam = options?.selectedPerson
    ? `?person=${encodeURIComponent(options.selectedPerson)}`
    : "";

  const calendarHref = options?.calendarMonth
    ? `/calendar?month=${options.calendarMonth}${options.selectedPerson ? `&person=${encodeURIComponent(options.selectedPerson)}` : ""}`
    : `/calendar${personParam}`;

  const eventsHref = options?.eventsDate
    ? `/events?date=${options.eventsDate}${options.selectedPerson ? `&person=${encodeURIComponent(options.selectedPerson)}` : ""}`
    : `/events${personParam}`;

  const bodyWithNonce = options?.nonce
    ? bodyContent
        .replace(/<style>/g, `<style nonce="${options.nonce}">`)
        .replace(/<script>/g, `<script nonce="${options.nonce}">`)
        .replace(/<script type=/g, `<script nonce="${options.nonce}" type=`)
    : bodyContent;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | UniFi Protect Assistant</title>
  <style${nonceAttr}>
    /* ---------------------------------------------------
       Design tokens
       --------------------------------------------------- */
    :root {
      --bg: #0a0a0c;
      --surface: #131316;
      --surface-2: #1a1a1e;
      --border: #232328;
      --border-strong: #333338;

      --text: #e8e8ea;
      --text-muted: #96969e;
      --text-faint: #616167;

      --accent: #4d82f3;
      --accent-soft: rgba(77, 130, 243, 0.14);

      --success: #34c77b;
      --success-soft: rgba(52, 199, 123, 0.14);

      --warning: #e0a63c;
      --warning-soft: rgba(224, 166, 60, 0.14);

      --danger: #e5674f;
      --danger-soft: rgba(229, 103, 79, 0.14);

      --radius-sm: 6px;
      --radius-md: 10px;

      --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      line-height: 1.5;
      padding: 1.5rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      -webkit-font-smoothing: antialiased;
    }

    /* ---------------------------------------------------
       Shell: header / nav / main / footer
       --------------------------------------------------- */
    header {
      width: 100%;
      max-width: 1160px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.75rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      color: inherit;
      text-decoration: none;
    }

    .brand:hover h1 {
      color: var(--text);
    }

    .brand-mark {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: var(--accent);
      flex-shrink: 0;
    }

    h1 {
      font-size: 0.95rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text);
    }

    nav {
      display: flex;
      gap: 0.25rem;
      align-items: center;
      flex-wrap: wrap;
    }

    nav a, nav button.sign-out {
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.85rem;
      padding: 0.4rem 0.75rem;
      border-radius: var(--radius-sm);
      transition: color 0.15s ease, background-color 0.15s ease;
      border: none;
      background: transparent;
      font-family: var(--font);
      cursor: pointer;
    }

    nav a:hover, nav button.sign-out:hover {
      color: var(--text);
      background: var(--surface);
    }

    nav a.active {
      color: var(--text);
      background: var(--surface-2);
    }

    main {
      width: 100%;
      max-width: 1160px;
      flex: 1;
    }

    footer {
      width: 100%;
      max-width: 1160px;
      text-align: center;
      padding: 1.75rem 0 0.5rem;
      color: var(--text-faint);
      font-size: 0.78rem;
      border-top: 1px solid var(--border);
      margin-top: 2.5rem;
    }

    footer a {
      color: var(--accent);
      text-decoration: none;
    }

    /* ---------------------------------------------------
       Core components
       --------------------------------------------------- */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 1.25rem;
    }

    .table-container {
      overflow-x: auto;
      margin-top: 0.75rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.7rem;
      letter-spacing: 0.04em;
      color: var(--text-faint);
      padding: 0.6rem 0.85rem;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    td {
      padding: 0.75rem 0.85rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.86rem;
      white-space: nowrap;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: var(--surface-2);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.82em;
    }

    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: var(--radius-sm);
      font-size: 0.72rem;
      font-weight: 600;
      background: var(--accent-soft);
      color: var(--accent);
    }

    .badge-accent {
      background: var(--success-soft);
      color: var(--success);
    }

    @media (max-width: 640px) {
      body {
        padding: 1rem;
      }
      header {
        flex-direction: column;
        gap: 0.85rem;
        align-items: flex-start;
      }
      nav {
        width: 100%;
      }
      nav a, nav button.sign-out {
        flex: 1;
        text-align: center;
      }
    }
  </style>
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
    ${bodyWithNonce}
  </main>

  <footer>
    <p>UniFi Protect Assistant &copy; 2026. Data local to America/New_York.</p>
  </footer>

  <script${nonceAttr}>
    // Set active class on nav links
    const path = window.location.pathname;
    if (path.startsWith('/today')) {
      document.getElementById('nav-today').classList.add('active');
    } else if (path.startsWith('/people')) {
      document.getElementById('nav-people').classList.add('active');
    } else if (path.startsWith('/health')) {
      document.getElementById('nav-health').classList.add('active');
    } else if (path.startsWith('/events')) {
      document.getElementById('nav-events').classList.add('active');
    } else {
      document.getElementById('nav-calendar').classList.add('active');
    }

  </script>
</body>
</html>`;
}
