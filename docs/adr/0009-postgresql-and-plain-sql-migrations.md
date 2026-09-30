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
  disappears stops the run. Changes go in new migrations. Files `0001` through `0020` stay
  as applied; their checksums stay valid.
- **No ORM and no database abstraction layer.** SQL text remains the interface to PostgreSQL.
- **No npm database package,** except the hosted-runtime client below. Local and CI database
  scripts stay on in-container `psql` and `pg_dump`.
- **Exception — one hosted runtime client.** A hosted or Vercel process has no Docker socket
  and no `psql`. Exactly one in-process PostgreSQL client may be added so that process can
  send the existing SQL. The client executes SQL text. It is not a query builder, an ORM, or
  a second schema. This exception does not add the dependency, choose the package, connect a
  production database, change environment files, or alter `bdc_reader` or
  `bdc_pipeline_writer`.
- **Schema snapshot:** `db/schema.snapshot.sql` is a normalized schema-only dump, updated in
  the same change as the migration (`npm run db:snapshot`) and compared by `npm run db:test`.
- **Tests:** SQL assertion files in `db/tests/`, each run as one transaction that is rolled
  back. Obviously fake structural values are allowed only there (see `tests-and-fixtures.mdc`).
- **Roles:** `bdc_pipeline_writer` (INSERT and SELECT) and `bdc_reader` (views only). The
  migration owner owns every object. Those privileges stay as granted by the existing
  migrations.

## Consequences

- Constraints live next to the data and cannot be bypassed by a buggy client.
- Running database tests requires Docker. Without it, `npm run db:test` runs its static checks
  and skips the database steps locally; CI always runs them.
- Down migrations do not exist; reverting a change means writing a new forward migration.
- The production host remains undecided, and no managed database is connected by this
  record. The hosted client, when added, still runs the existing SQL and the existing roles.
- A typed query layer is outside this exception.
