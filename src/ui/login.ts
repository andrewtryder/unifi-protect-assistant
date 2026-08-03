import { escapeHtml } from "./html.js";

export function renderLoginPage(errorMessage?: string, nonce?: string): string {
  const errorHtml = errorMessage
    ? `<p class="login-error" role="alert">${escapeHtml(errorMessage)}</p>`
    : "";
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In | UniFi Protect Assistant</title>
  <style${nonceAttr}>
    :root {
      --bg: #0a0a0c;
      --surface: #131316;
      --border: #232328;
      --text: #e8e8ea;
      --text-muted: #96969e;
      --accent: #4d82f3;
      --danger: #e5674f;
      --danger-soft: rgba(229, 103, 79, 0.14);
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
      -webkit-font-smoothing: antialiased;
    }

    .login-card {
      width: 100%;
      max-width: 360px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 2.25rem 1.75rem;
      text-align: center;
    }

    .brand-mark {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--accent);
      display: inline-block;
      margin-bottom: 1rem;
    }

    h1 {
      font-size: 1.15rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 1.75rem;
    }

    .login-error {
      background: var(--danger-soft);
      color: var(--danger);
      border-radius: 6px;
      padding: 0.75rem 0.9rem;
      margin-bottom: 1.25rem;
      font-size: 0.85rem;
    }

    .google-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #fff;
      color: #1f1f1f;
      font-family: var(--font);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      text-decoration: none;
    }

    .google-btn:hover { filter: brightness(0.97); }
  </style>
</head>
<body>
  <div class="login-card">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1>UniFi Protect Assistant</h1>
    <p class="subtitle">Sign in with an allowed Google account</p>
    ${errorHtml}
    <button type="button" class="google-btn" id="google-sign-in">Continue with Google</button>
  </div>
  <script${nonceAttr}>
    document.getElementById('google-sign-in').addEventListener('click', async () => {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' })
      });
      if (!res.ok) {
        window.location.href = '/login?error=' + encodeURIComponent('Sign-in failed');
        return;
      }
      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        window.location.href = '/login?error=' + encodeURIComponent('Sign-in failed');
      }
    });
  </script>
</body>
</html>`;
}
