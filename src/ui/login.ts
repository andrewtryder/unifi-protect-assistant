import { escapeHtml } from "./html.js";

export function renderLoginPage(errorMessage?: string): string {
  const errorHtml = errorMessage
    ? `<p class="login-error" role="alert">${escapeHtml(errorMessage)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In | UniFi Protect Assistant</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0c;
      --surface: #131316;
      --border: #232328;
      --text: #e8e8ea;
      --text-muted: #96969e;
      --accent: #4d82f3;
      --danger: #e5674f;
      --danger-soft: rgba(229, 103, 79, 0.14);
      --font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
      margin: 0 auto 1rem;
    }

    h1 {
      font-size: 1.05rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 0.4rem;
    }

    .login-subtitle {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-bottom: 1.75rem;
    }

    .login-error {
      color: var(--danger);
      background: var(--danger-soft);
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      font-size: 0.82rem;
      margin-bottom: 1.1rem;
    }

    .google-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.65rem;
      width: 100%;
      padding: 0.7rem 1.1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }

    .google-btn:hover:not(:disabled) {
      border-color: #333338;
      background: #0f0f12;
    }

    .google-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .google-btn svg {
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="brand-mark"></div>
    <h1>UniFi Protect Assistant</h1>
    <p class="login-subtitle">Sign in with an authorized Google account to continue.</p>
    ${errorHtml}
    <button type="button" class="google-btn" id="google-signin">
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Sign in with Google
    </button>
  </div>
  <script>
    const btn = document.getElementById('google-signin');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/sign-in/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            provider: 'google',
            callbackURL: '/calendar'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        const msg = data.message || data.error || 'Sign-in failed. Please try again.';
        window.location.href = '/login?error=' + encodeURIComponent(msg);
      } catch (err) {
        window.location.href = '/login?error=' + encodeURIComponent('Sign-in failed. Please try again.');
      }
    });
  </script>
</body>
</html>`;
}
