# Cloudflare Access

Dashboard HTML and JSON routes require Cloudflare Access at the edge and a second check inside the Worker (JWT + `ALLOWED_EMAILS`).

## Allowlist

`ALLOWED_EMAILS` is a comma-separated list of **exact** email addresses (no wildcards, no domain-only rules). Entries are trimmed, lowercased, deduped; malformed lists fail closed.

The same list drives:

1. Access **Allow** policy (one exact-email rule per address)
2. Worker authorization after JWT validation

After changing the allowlist, re-run provisioning and refresh Worker secrets:

```bash
npm run access:configure
```

Dry-run (no mutations):

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… ALLOWED_EMAILS='you@example.com' \
  node scripts/configure-cloudflare-access.mjs --dry-run
```

`CLOUDFLARE_API_TOKEN` is for provisioning/deploy only. It is never a Worker runtime secret.

## Worker JWT checks

Protected requests must present `Cf-Access-Jwt-Assertion`. The Worker validates the token against JWKS at `{CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, then checks issuer, audience (`CF_ACCESS_AUD`), time claims, and that `email` is in `ALLOWED_EMAILS`.

## Path exceptions

UniFi Protect cannot complete a browser Access login. A separate Access application should **Bypass** only the webhook path (`…/unifi`). A second path-scoped Bypass covers public `GET /ready` (no secrets or PII). Worker-side `X-Webhook-Secret` validation remains mandatory on `/unifi`.

## Local development

Set `ALLOW_LOCAL_AUTH_BYPASS=true` in `.dev.vars` for `localhost` / `127.0.0.1` only. Never enable in production.

Logout: `/cdn-cgi/access/logout`.
