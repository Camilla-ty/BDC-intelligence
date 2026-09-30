# Definition of Done

Every pull request must satisfy the universal checklist, plus the section for each type of
change it contains. Guardrail IDs (G-01 to G-17) are defined in the root `AGENTS.md`.

## Universal (every pull request)

- [ ] The change is within the approved phase and scope (G-17).
- [ ] `npm run verify` passes locally, and CI is green.
- [ ] Tests were added or updated for the behavior changed.
- [ ] No new dependency, service, or data source was added without approval.
- [ ] No local-only files are included (G-16).
- [ ] The pull request lists the guardrail IDs it touches.
- [ ] Gaps are labeled OPEN QUESTION, ENGINEERING DECISION, or FUTURE / NOT MVP, not
      silently filled.
- [ ] `docs/METHODOLOGY.md` or an ADR in `docs/adr/` is updated if a definition or decision changed.

## SEC sources and data ingestion

- [ ] Every SEC endpoint, file, and field used is documented with an official citation (G-03).
- [ ] Raw artifacts are stored immutably with source URL, retrieval time, and checksum (G-12).
- [ ] Raw values are preserved next to normalized values, with the rule version (G-11).
- [ ] Re-running with the same inputs produces the same result.
- [ ] Fetch and load are separate; CI does not use the network; real SEC bytes are not committed.
- [ ] `/A` filings receive an UNRESOLVED AMENDS decision with no target (no amendment matching).
- [ ] Cross-source disagreements remain visible; no automatic winner.
- [ ] SOI rows are identified by table load and line number; duplicate accession/identifier/date/`qtrs` groups are not merged.
- [ ] SOI observations link to filings by the `adsh` cell only; the accession prefix is never a registrant CIK.
- [ ] `SOI_HOLDINGS` coverage is asserted separately from `FILING_METADATA`; empty or missing SOI is not zero holdings.
- [ ] Q14 cost and fair-value source columns remain provisional observed fields and cannot feed derived values.

## Schema and storage

- [ ] Historical observations and resolution decisions are append-only (G-10).
- [ ] Unknown is representable explicitly and is not stored as zero or blank (G-04).
- [ ] CIK appears only on registrant and filing records (G-09).
- [ ] Every material fact can be linked to its source document (G-12).
- [ ] Schema changes are new forward-only migrations; no applied migration was edited.
- [ ] `db/schema.snapshot.sql` is regenerated and `npm run db:test` passes, with new
      assertions for every new constraint, trigger, or view.
- [ ] No unique constraint uses SOI-derived business columns.
- [ ] `docs/DATA_MODEL.md` is updated if tables, views, or authority rules changed.

## Identity resolution

- [ ] Only MATCHED, PROBABLE, UNRESOLVED, and REJECTED are used (G-13).
- [ ] Legal entity, economic group, and instrument are resolved separately (G-14, G-15).
- [ ] Fuzzy matching only produces candidates; ambiguous cases stay UNRESOLVED.
- [ ] Every decision records state (its confidence classification), method, evidence, reason,
      and rule version.

## Derived metrics, events, and signals

- [ ] Computation is deterministic code with unit tests; no LLM arithmetic (G-07, G-08).
- [ ] The definition and version are documented in `docs/METHODOLOGY.md`.
- [ ] Unknown inputs produce Unknown outputs, not zero (G-04).
- [ ] No composite scores or opaque rankings (G-06).

## Web UI

- [ ] Unknown is rendered as "Unknown"; missing coverage is not shown as zero (G-04, G-05).
- [ ] Derived values are labeled; reported values link to their source.
- [ ] The web layer formats values only and performs no financial arithmetic (G-07).
- [ ] No mock financial data, borrower names, or BDC names in components or demos (G-02).
- [ ] Screenshots are attached to the pull request.

## Documentation only

- [ ] No confidential product details, requirement-document section references, or
      quotations are added to public files.
- [ ] Links and file paths are valid.
