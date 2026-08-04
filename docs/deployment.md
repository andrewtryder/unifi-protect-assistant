# Deployment

Production runs on Cloudflare Workers with D1, KV, Cloudflare Access, and a daily cron. Prefer the GitHub Actions workflow on `main` after the quality job succeeds.

## GitHub Actions

On pull requests, the **quality** job runs install, typecheck, lint, Prettier, tests with coverage (artifact uploaded), local D1 migrate, and selected integration checks.

On `main` (and `workflow_dispatch`), **deploy** provisions Access from `ALLOWED_EMAILS`, applies remote D1 migrations, deploys the Worker (syncing secrets), runs smoke checks, and can roll back the Worker if smoke fails after a successful deploy.

### Repository secrets

| GitHub secret           | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API (Workers, D1, KV, Access) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID                    |
| `WEBHOOK_SECRET`        | Shared secret for `POST /unifi`          |
| `ALLOWED_EMAILS`        | Exact-email allowlist                    |
| `HONEYBADGER_API_KEY`   | Optional error reporting                 |

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are normally written to the Worker during deploy from Access provisioning output.

Dependabot opens weekly PRs for npm (grouped minor/patch) and GitHub Actions.

## Manual deploy

1. Export or otherwise back up production D1 before migrations:

   ```bash
   npx wrangler d1 export unifi_protect_db --remote --output backup.sql
   ```

2. Apply remote migrations:

   ```bash
   npm run db:migrate:prod
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

Set Worker secrets with `npx wrangler secret put <NAME>` when not using CI sync. D1 migrations are forward-only; Worker code can be rolled back with `wrangler rollback`, but schema changes are not automatically reversible.

## Local quality gate

```bash
npm run check
```

After `npm ci`, Husky installs a pre-commit hook that runs the same gate.
