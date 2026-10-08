# Architecture Decision Records

Each ADR records one decision: its context, the decision, and its consequences. ADRs are
numbered sequentially and never renumbered. To change a decision, add a new ADR that
supersedes the old one and update the old one's status.

Scope: decisions that have actually been made, and established engineering principles.
Implementation choices (database, data access, ingestion pipeline, storage,
authentication, and similar) are recorded in the phase in which they are decided.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-monorepo-and-web-toolchain.md) | Monorepo and web toolchain | Accepted |
| [0003](0003-local-only-reference-materials.md) | Local-only reference materials | Accepted |
| [0004](0004-evidence-first-source-hierarchy.md) | Evidence-first source hierarchy | Accepted |
| [0005](0005-append-only-history-and-raw-preservation.md) | Append-only history and raw value preservation | Accepted |
| [0006](0006-identity-layers-and-resolution-states.md) | Identity layers and resolution states | Accepted |
| [0007](0007-deterministic-computation-and-llm-boundary.md) | Deterministic computation and the LLM boundary | Accepted |
| [0008](0008-no-opaque-scores-or-rankings.md) | No opaque scores or rankings | Accepted |
| [0009](0009-postgresql-and-plain-sql-migrations.md) | PostgreSQL and plain SQL migrations | Accepted |
| [0010](0010-observation-provenance-and-authority-model.md) | Observation, provenance, and authority model | Accepted |
| [0011](0011-registry-ingestion.md) | Registry ingestion pipeline | Accepted |
| [0012](0012-soi-ingestion.md) | SOI ingestion pipeline | Accepted |
| [0013](0013-supabase-auth-email-otp.md) | Supabase Auth with email one-time codes | Accepted |
| [0014](0014-application-authorization.md) | Application authorization ledger | Accepted |

## Template

```markdown
# NNNN. Title

## Status

Proposed | Accepted | Superseded by NNNN

## Context

Why a decision is needed; forces and constraints.

## Decision

What was decided.

## Consequences

What becomes easier or harder; follow-up work.
```
