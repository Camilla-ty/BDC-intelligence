# 0009. PostgreSQL and plain SQL migrations

## Status

Accepted

## Context

The core schema needs a relational database with strong constraints, triggers, enums, and
role privileges to enforce append-only history and provenance in the database itself.
ADR 0002 left the database and data-access choices open. The project avoids new dependencies
unless they are necessary, and the schema must be testable locally and in CI.

## Decision

- **Engine:** PostgreSQL 17.
- **Local and CI testing:** the official `postgres:17` Docker image. Locally, a disposable
  container with no published ports and no volume (`npm run db:up`, `npm run db:down`); in CI,
  a PostgreSQL service container. `psql` and `pg_dump` run inside the container.
- **Not decided here:** the production database host or provider. Docker is test
  infrastructure only; no managed database is connected.
- **Migrations:** plain SQL files in `db/migrations/NNNN_name.sql`, forward-only and
  checksummed. A Node runner (`scripts/db/migrate.mjs`, built-ins only) applies each file and
  its ledger row in `ops.schema_migration` in one transaction. An applied file that changes or
  disappears stops the run. Changes go in new migrations.
- **No ORM and no npm database package.**
- **Schema snapshot:** `db/schema.snapshot.sql` is a normalized schema-only dump, updated in
  the same change as the migration (`npm run db:snapshot`) and compared by `npm run db:test`.
- **Tests:** SQL assertion files in `db/tests/`, each run as one transaction that is rolled
  back. Obviously fake structural values are allowed only there (see `tests-and-fixtures.mdc`).
- **Roles:** `bdc_pipeline_writer` (INSERT and SELECT) and `bdc_reader` (views only). The
  migration owner owns every object.

## Consequences

- Constraints live next to the data and cannot be bypassed by a buggy client.
- Running database tests requires Docker. Without it, `npm run db:test` runs its static checks
  and skips the database steps locally; CI always runs them.
- Down migrations do not exist; reverting a change means writing a new forward migration.
- A typed web query layer and the production host are decided in later phases.
