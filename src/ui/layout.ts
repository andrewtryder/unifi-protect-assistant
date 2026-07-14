export function renderLayout(
  title: string,
  bodyContent: string,
  options?: { selectedPerson?: string; calendarMonth?: string; eventsDate?: string }
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | UniFi Protect Assistant</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Plus+Jakarta+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090b11;
      --panel: rgba(17, 22, 34, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-glow: rgba(99, 102, 241, 0.15);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.15);
      --font-heading: 'Outfit', sans-serif;
      --font-body: 'Plus Jakarta Sans', sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text);
      font-family: var(--font-body);
      line-height: 1.5;
      padding: 1.5rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    header {
      width: 100%;
      max-width: 1200px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    h1 {
      font-family: var(--font-heading);
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    nav {
      display: flex;
      gap: 1rem;
      align-items: center;
      flex-wrap: wrap;
    }

    nav a, nav button.sign-out {
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.9rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      transition: all 0.2s ease;
      border: 1px solid transparent;
      background: transparent;
      font-family: var(--font-body);
      cursor: pointer;
    }

    nav a:hover, nav a.active, nav button.sign-out:hover {
      color: var(--text);
      background: var(--panel);
      border-color: var(--border);
    }

    main {
      width: 100%;
      max-width: 1200px;
      flex: 1;
    }

    footer {
      width: 100%;
      max-width: 1200px;
      text-align: center;
      padding: 2rem 0;
      color: var(--text-muted);
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }

    footer a {
      color: var(--primary);
      text-decoration: none;
    }

    /* Glassmorphism utility card */
    .glass-card {
      background: var(--panel);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }

    /* Standard tables and layout grids */
    .table-container {
      overflow-x: auto;
      margin-top: 1rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      font-family: var(--font-heading);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 1rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
      white-space: nowrap;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
    }

    .badge-accent {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
    }

    @media (max-width: 640px) {
      body {
        padding: 1rem;
      }
      header {
        flex-direction: column;
        gap: 1rem;
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
    <h1>UniFi Protect Assistant</h1>
    <nav>
      <a href="/today" id="nav-today">Today</a>
      <a href="/people" id="nav-people">People</a>
      <a href="${calendarHref}" id="nav-calendar">Calendar</a>
      <a href="${eventsHref}" id="nav-events">Events Log</a>
      <a href="/health" id="nav-health">Health</a>
      <button type="button" class="sign-out" id="sign-out">Sign out</button>
    </nav>
  </header>
  
  <main>
    ${bodyContent}
  </main>

  <footer>
    <p>UniFi Protect Assistant &copy; 2026. Data local to America/New_York.</p>
  </footer>

  <script>
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

    document.getElementById('sign-out').addEventListener('click', async () => {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      window.location.href = '/login';
    });
  </script>
</body>
</html>`;
}
