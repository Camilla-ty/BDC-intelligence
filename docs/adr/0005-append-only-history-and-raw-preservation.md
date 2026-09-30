# 0005. Append-only history and raw value preservation

## Status

Accepted (principle). The storage mechanism is decided in the data-model phase.

## Context

Disclosures are published over time and are sometimes amended or re-extracted.
Normalization and resolution rules will evolve. Overwriting data would make past outputs
unreproducible and hide corrections.

## Decision

- Historical observations and resolution decisions are append-only (G-10). A change
  creates a new version that references what it supersedes, with reason, actor, and time.
- The raw value exactly as disclosed is preserved next to the normalized value, with the
  normalization rule version (G-11).
- Each dataset row is treated as a historical observation, not a duplicate.

## Consequences

- Storage grows with history; this is accepted.
- Any past output can be reproduced from raw inputs and rule versions.
- "Current" views are derived from history by an explicit, documented precedence rule.
