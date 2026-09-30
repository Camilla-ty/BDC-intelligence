# 0007. Deterministic computation and the LLM boundary

## Status

Accepted

## Context

Financial figures must be reproducible and auditable. Language models are
non-deterministic and can produce confident but wrong arithmetic or facts.

## Decision

- All financial arithmetic (ratios, aggregations, spreads, period-over-period changes)
  is performed by versioned, unit-tested, deterministic code (G-07).
- An LLM is never authoritative for financial facts, identity decisions, or arithmetic
  (G-08). Structured ingestion is never replaced by an LLM.
- If LLM assistance is approved in a later phase, it may only produce candidates that
  retain their evidence and a review status.
- The web layer formats values and performs no financial arithmetic.

## Consequences

- Every derived figure can be recomputed and explained.
- Whether LLM assistance is used at all is decided in a later phase.
