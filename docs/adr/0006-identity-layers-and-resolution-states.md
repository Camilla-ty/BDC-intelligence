# 0006. Identity layers and resolution states

## Status

Accepted (principle). The matching policy and implementation are decided in the
resolution phases.

## Context

One borrower may appear under differing names in filings from different registrants, and one
borrower can have several distinct instruments. SEC identifiers describe filers, not
their portfolio holdings. Wrong merges silently corrupt every downstream figure.

## Decision

- A CIK identifies the SEC registrant (the filing entity) and is used only on registrant
  and filing records. It is never a borrower, legal-entity, or economic-group key (G-09).
- Legal entity, economic group, and instrument are separate concepts, each resolved
  independently (G-14).
- The same borrower does not imply the same instrument; different tranches and securities
  are never merged (G-15).
- Resolution decisions use exactly the states MATCHED, PROBABLE, UNRESOLVED, and REJECTED
  (G-13). Ambiguous cases stay UNRESOLVED. Similarity matching only produces candidates.
- Every decision records state, method, confidence classification, evidence, and rule
  version, and changes are versioned (G-10).

## Consequences

- Some borrowers will remain UNRESOLVED and be shown as such.
- Cross-registrant views depend on the resolution state; how each state is used in
  aggregates is an open question for the resolution phases.
