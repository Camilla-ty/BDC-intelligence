# AGENTS.md

Instructions for AI coding agents (Cursor, Claude Code, Codex, and similar) and for
human contributors working in this repository.

## Project

BDC Intelligence is a credit-research application built on public disclosures from
Business Development Companies (BDCs). Its value depends entirely on data integrity:
every figure must be traceable to a public source document, and anything that cannot be
supported by evidence must be shown as Unknown rather than guessed.

## Guardrails

These guardrails are non-negotiable. The IDs are stable; rules, pull requests, and
reviews refer to them. Detailed guidance lives in the scoped rules under `.cursor/rules/`.

| ID | Guardrail |
| --- | --- |
| G-01 | **Evidence over inference.** State only what a source document supports. When evidence is missing, record the gap instead of inferring a value. |
| G-02 | **No fabricated financial data.** Never invent borrowers, BDCs, positions, amounts, rates, dates, or filing facts in code, fixtures, seeds, UI, demos, or docs. The only exception is obviously fake values inside unit tests of deterministic arithmetic (see `tests-and-fixtures.mdc`). |
| G-03 | **No invented SEC endpoints or fields.** Use only SEC endpoints, files, and fields that are documented from official SEC sources in the repository's source-schema documentation. If something is undocumented, stop and ask. |
| G-04 | **Unknown and Unresolved are valid states.** They are legitimate production values. Never replace them with a default, a guess, zero, or a blank. |
| G-05 | **Missing coverage is not zero exposure.** A missing period, filing, BDC, or field is recorded and displayed as missing, never as 0. |
| G-06 | **No arbitrary scores or rankings.** No composite scores, grades, or opaque rankings. Sorting by a single explicit, visible attribute is allowed. |
| G-07 | **Deterministic arithmetic stays in code.** Ratios, aggregations, spreads, and period-over-period changes are computed by versioned, tested, deterministic code. |
| G-08 | **An LLM is never authoritative.** LLM output is never a source of financial facts or arithmetic. It may only produce reviewable candidates that keep their evidence and review status. |
| G-09 | **CIK identifies the SEC registrant, not the borrower.** A CIK identifies the filing entity (typically the BDC). It is never a portfolio borrower, legal-entity, or economic-group identifier. |
| G-10 | **Never silently overwrite history.** Historical observations and resolution decisions are append-only; changes create a new version with a reason and audit trail. |
| G-11 | **Preserve raw source values.** The value exactly as disclosed is kept alongside any normalized value, with the normalization rule version. |
| G-12 | **Retain source provenance.** Every material fact links to its source document, filing identifier, location, retrieval time, and parser or rule version. |
| G-13 | **Resolution states are explicit.** Entity and instrument resolution use exactly MATCHED, PROBABLE, UNRESOLVED, and REJECTED. Ambiguous cases stay UNRESOLVED. |
| G-14 | **Legal entity, economic group, and instrument are separate concepts.** Each is resolved separately and none is inferred from another. |
| G-15 | **Same borrower does not imply same instrument.** Different loans, tranches, or securities of one borrower are never merged. |
| G-16 | **`/reference/` is local-only.** Files under `/reference/` (and the local implementation plan) are never modified, never committed, and never force-added. |
| G-17 | **Do not expand scope.** Build only what the approved scope and current phase require. Do not add features, data sources, or dependencies that were not approved. |

## Order of precedence

1. The guardrails above.
2. The approved scope for the current phase.
3. Architecture decision records in `docs/adr/`.
4. Scoped rules in `.cursor/rules/`.
5. Framework notes (for Next.js, `apps/web/AGENTS.md`).

If a request would violate a guardrail, say so explicitly and ask for confirmation.
Do not silently comply and do not silently work around it.

## Working in phases

- Implement only the phase that has been explicitly approved.
- When requirements are missing or ambiguous, label the item **OPEN QUESTION**,
  **ENGINEERING DECISION**, or **FUTURE / NOT MVP** and ask. Do not fill gaps silently.
- The detailed implementation plan is a local-only file (`docs/IMPLEMENTATION_PLAN.md`)
  and may be absent (for example in CI or cloud agents). If you need it and it is not
  present, ask instead of guessing.

## Stop and ask when

- a required SEC endpoint, file, or field is not documented from an official source;
- an entity or instrument resolution would require a judgment the evidence does not support;
- a new dependency, service, or data source seems necessary;
- the request falls outside the current phase or approved scope;
- a change would touch `/reference/` or another local-only file.

## Git and deployment

- Do not commit, push, add remotes, or change deployment configuration unless explicitly asked.
- Never use `git add -f` on ignored files.
- `npm run verify:no-reference-tracked` fails if local-only files are tracked.

## Commands

Run from the repository root:

```bash
npm run verify            # all checks below, in sequence
npm run verify:guardrails # guardrail files, rule configuration, ADR structure
npm run verify:reference  # local-only reference checksums (skipped when absent)
npm run verify:no-reference-tracked
npm run verify:source-schemas
npm run db:test # migrations, schema snapshot, rolled-back SQL tests (Docker; skipped locally without it)
npm run test:pipeline # network-free pipeline unit tests
npm run test:pipeline:integration # synthetic loader test (Docker; skipped locally without it)
npm run lint
npm run typecheck
npm test
npm run build
npm run registry:fetch # local only; needs SEC_USER_AGENT; writes .data/sec/
npm run registry:load  # offline rebuild from the fetch log
npm run soi:load       # offline SOI projection from already-loaded ZIP artifacts
npm run soi:reconcile  # local only: compare soi.tsv line counts to the database
npm run maturity:inspect -- --accession ACCESSION  # filing maturity inspection; HTML fetch needs SEC_USER_AGENT
npm run p4:golden      # Golden slice borrower-name observations; no fetch
npm run p5:golden      # Golden slice filing-document fetch + string checks; needs SEC_USER_AGENT
npm run p6:golden      # Golden slice legal-entity resolution; no fetch
npm run p7:golden      # Golden slice instrument identity + per-BDC continuity; no fetch
npm run golden:gate    # Phase 8 Golden Borrower Gate; no fetch; does not expand the universe
npm run p9:golden      # Phase 9-min first-observed events for the Golden slice; no fetch
```

## Where things live

| Path | Contents |
| --- | --- |
| `.cursor/rules/` | Scoped agent rules; `00-core-guardrails.mdc` always applies |
| `docs/METHODOLOGY.md` | Data methodology principles and structure |
| `docs/DATA_MODEL.md` | Database layers, lineage, authority rules, and error codes |
| `db/` | PostgreSQL migrations, schema snapshot, and SQL tests; see `.cursor/rules/db-schema.mdc` |
| `docs/DEFINITION_OF_DONE.md` | Checklist every pull request must satisfy |
| `docs/adr/` | Architecture decision records |
| `pipeline/` | Fetch/load pipeline (Phase 2 registry, Phase 3 SOI); see ADR 0011 and ADR 0012 |
| `apps/web/` | Next.js application; see `apps/web/AGENTS.md` for framework specifics |
| `scripts/` | Repository verification scripts; `scripts/db/` holds the database runners |
