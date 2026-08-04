# Deployment

Production runs on Cloudflare Workers with D1, KV, Cloudflare Access, and a daily cron. Prefer the GitHub Actions **Deploy** workflow on `main` after its `quality` job succeeds.

## GitHub Actions

| Workflow           | When                                 | What                                                                                                                                                                      |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI**             | PRs and pushes to `main`             | `quality`: install, typecheck, lint, Prettier, tests + coverage thresholds, coverage artifact, `wrangler deploy --dry-run`, local D1 migrate, selected integration checks |
| **Deploy**         | Push to `main` / `workflow_dispatch` | Re-runs `quality`, then Access provisioning, remote D1 migrate, Worker deploy, smoke, optional rollback                                                                   |
| **PR title**       | PR open/edit                         | Conventional Commits title check (squash-oriented)                                                                                                                        |
| **Actions lint**   | Workflow file changes                | `actionlint` + `zizmor`                                                                                                                                                   |
| **Release Please** | Push to `main`                       | Changelog + version PR / GitHub Release (no npm publish)                                                                                                                  |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for PR title conventions. Prefer enabling GitHub **CodeQL default setup** in repository Settings → Code security.

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
