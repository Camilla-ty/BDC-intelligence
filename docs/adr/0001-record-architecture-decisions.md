# 0001. Record architecture decisions

## Status

Accepted

## Context

The project is built incrementally, in phases, by human contributors and AI coding agents.
Decisions made in one phase must remain visible and binding in later phases, or agents will
re-decide them inconsistently.

## Decision

Record significant architecture decisions and engineering principles as numbered ADRs in
`docs/adr/`, using the template in `docs/adr/README.md`. Each ADR contains the headings
Status, Context, Decision, and Consequences. `npm run verify:guardrails` checks this.

Only decisions that have actually been made are recorded. Pending choices are recorded in
the phase in which they are decided.

## Consequences

- Agents and reviewers have one place to check before re-opening a decision.
- Changing a decision requires a new, superseding ADR rather than an edit in place.
