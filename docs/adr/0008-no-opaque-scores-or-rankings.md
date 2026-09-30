# 0008. No opaque scores or rankings

## Status

Accepted

## Context

Composite scores and rankings hide their inputs and weighting, which conflicts with an
evidence-first product and invites unsupported conclusions.

## Decision

- No composite or weighted scores, grades, or opaque rankings are produced or displayed (G-06).
- Individual observations and signals are shown separately, each with its evidence.
- Sorting or filtering by one explicit, visible attribute is allowed.
- Internal work-queue ordering that customers do not see is allowed.
- A match-confidence classification that names the deterministic rule that fired is a
  description of method, not a credit assessment.

## Consequences

- Users compare explicit facts rather than a single number.
- Whether any summary status label is shown, and how it is defined, is an open question
  for the UI phases. Automated wording checks for UI text are deferred to the UI phase.
