# Contributing

## Development

```bash
npm ci
npm run check   # typecheck + lint + Prettier + tests with coverage
```

Husky runs `npm run check` on pre-commit after `npm install` / `npm ci`.

## Pull requests

Prefer **squash merges**. The PR title becomes the squash commit subject and feeds [Release Please](https://github.com/googleapis/release-please) changelogs.

Use a [Conventional Commits](https://www.conventionalcommits.org/) title:

```text
<type>(optional-scope): <description>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `deps`.

Examples:

- `feat: add vehicle day-log filter`
- `fix: fail closed when webhook secret is missing`
- `ci: add actionlint and zizmor`
- `deps: bump wrangler to 4.118.0`

## CI checks

Pull requests should pass:

- `quality` (CI workflow)
- `PR title`
- `actions-lint` (when workflow files change)

Do not commit secrets (`.env`, `.dev.vars`). Use `.env.example` placeholders.
