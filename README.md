# BDC Intelligence

BDC Intelligence is a credit-research application built on public disclosures from
Business Development Companies (BDCs). It aims to make BDC portfolio disclosures
searchable and historical, with every figure traceable to its source filing.

> **Status:** Phase 3. The repository can fetch verified SEC registry and filing-history
> sources into git-ignored local storage, load them offline into a disposable local
> PostgreSQL database, and project raw Schedule of Investments (SOI) rows from the same
> ZIP artifacts. Entity resolution, analytics, and UI are not implemented yet.

## Principles

- Evidence over inference — figures link back to their source documents.
- Unknown is a valid value — missing data is shown as unknown, never guessed.
- No opaque scores or rankings.

The full list of engineering guardrails is in [`AGENTS.md`](AGENTS.md), and the data
methodology principles are in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## Repository layout

```
apps/web/        Next.js (App Router) + TypeScript web application
db/              PostgreSQL migrations, schema snapshot, and database tests
pipeline/        Fetch/load (SEC HTTP client, parsers, offline registry and SOI loaders)
docs/            Methodology, data model, Definition of Done, architecture decision records
scripts/         Repository maintenance scripts
.cursor/rules/   Scoped rules for AI coding agents
.github/         CI workflow and pull request template
AGENTS.md        Guardrails and instructions for contributors and AI agents
```

## Prerequisites

- Node.js 24 (see `.nvmrc`; `nvm use` picks it up)
- npm (bundled with Node.js)
- Docker, for database tests only. `npm run db:test` runs a disposable `postgres:17`
  container with no published ports. Without Docker it runs only its static checks
  locally; CI always runs the database tests.

## Getting started

```bash
npm install
npm run dev
```

The app runs at <http://localhost:3000>.

Copy `.env.example` to `.env.local` and set `SEC_USER_AGENT` (project name and contact email)
before running `npm run sec:fetch` or `npm run registry:fetch`. The value is never logged
or committed.

## Scripts

Run from the repository root:

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next.js route types, then run `tsc --noEmit` |
| `npm test` | Run unit tests (Vitest + Testing Library) |
| `npm run verify:reference` | Check local-only reference files are unchanged (skipped when absent) |
| `npm run verify:no-reference-tracked` | Fail if local-only files are tracked by git |
| `npm run verify:guardrails` | Check guardrail docs, agent rule configuration, and ADR structure |
| `npm run verify:source-schemas` | Check `docs/SOURCE_SCHEMAS.md`, the SEC fixture manifest, and snapshots (offline) |
| `npm run test:pipeline` | Network-free pipeline unit tests (HTTP client, store, parsers, synthetic fetch) |
| `npm run test:pipeline:integration` | Offline loader integration test against disposable PostgreSQL (Docker; skipped locally without it) |
| `npm run db:test` | Apply migrations to a throwaway database, compare the schema snapshot, and run the rolled-back SQL tests |
| `npm run verify` | Run all of the above checks in sequence |
| `npm run db:up` / `npm run db:down` | Start or stop the local test PostgreSQL container |
| `npm run db:migrate` | Apply pending migrations to a local database (`-- --db NAME`, default `bdc_local`) |
| `npm run db:snapshot` | Regenerate `db/schema.snapshot.sql` after adding a migration |
| `npm run verify:source-fixtures` | Local only: recompute cached SEC file checksums and scan public files for leaked names (skipped without `.cache/sec/`) |
| `npm run sec:fetch` | Local only: download the SEC files listed in the manifest into `.cache/sec/` (needs `SEC_USER_AGENT` in `.env.local`) |
| `npm run sec:inspect` | Local only: regenerate structure-only snapshots from `.cache/sec/` (`-- --check` compares without writing) |
| `npm run registry:fetch` | Local only: download registry/filing-history sources into `.data/sec/` (needs `SEC_USER_AGENT`; never in CI) |
| `npm run registry:load` | Offline: load the fetch log and store into the local database (`-- --data-dir DIR`, `-- --db NAME`) |
| `npm run soi:load` | Offline: project `soi.tsv` from ZIP artifacts already loaded by `registry:load` |
| `npm run soi:reconcile` | Local only: compare `soi.tsv` line counts in `.data/sec/` to the database (no disclosed values printed) |

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) and React
- TypeScript (strict)
- Tailwind CSS v4 (configured in `apps/web/src/app/globals.css`)
- ESLint (flat config, `eslint-config-next`)
- Vitest + React Testing Library (jsdom)

## Local-only files

Some working documents are kept on developer machines only and are excluded by
`.gitignore`. They must never be committed. `npm run verify:no-reference-tracked` runs
in CI to enforce this.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and on pushes to
`main`: install, local-only file check, guardrail check, source-schema check, network-free
pipeline unit tests, lint, typecheck, test, and build. A separate job runs the database
tests and the synthetic pipeline integration tests against a PostgreSQL 17 service
container. Neither job fetches SEC data.

## Deploying to Vercel

1. Import the GitHub repository in Vercel.
2. Set **Root Directory** to `apps/web`.
3. Keep the **Framework Preset** as Next.js.
4. Set the Node.js version to **24.x** in Project Settings.

No `vercel.json` is required.

## Contributing

Work in feature branches and open a pull request against `main`. Read
[`AGENTS.md`](AGENTS.md) first. CI must pass, and every pull request must meet the
[Definition of Done](docs/DEFINITION_OF_DONE.md). Significant decisions are recorded in
[`docs/adr/`](docs/adr/README.md).
