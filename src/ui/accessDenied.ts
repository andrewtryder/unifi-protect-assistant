export function renderAccessDenied(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access denied | UniFi Protect Assistant</title>
  <style${nonceAttr}>
    :root {
      --bg: #0a0a0c;
      --surface: #131316;
      --border: #232328;
      --text: #e8e8ea;
      --text-muted: #96969e;
      --accent: #4d82f3;
      --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 2rem 1.75rem;
      text-align: center;
    }
    h1 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    p { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }
    a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access denied</h1>
    <p>You are not authorized to view this application.</p>
    <p style="margin-top:1rem;"><a href="/cdn-cgi/access/logout">Sign out</a></p>
  </div>
</body>
</html>`;
}
