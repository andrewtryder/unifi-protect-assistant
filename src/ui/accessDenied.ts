export function renderAccessDenied(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access denied | UniFi Protect Assistant</title>
  <link rel="stylesheet" href="/assets/app.css">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
</head>
<body class="access-denied">
  <div class="access-denied-card">
    <h1>Access denied</h1>
    <p>You are not authorized to view this application.</p>
    <p class="mt-1"><a href="/cdn-cgi/access/logout">Sign out</a></p>
  </div>
</body>
</html>`;
}
