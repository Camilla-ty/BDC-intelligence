# 0012. SOI ingestion pipeline

## Status

Accepted

## Context

Phase 2 stores BDC data-set ZIP artifacts and checksums every member, but parses only
`datasets/sub.tsv`. The Schedule of Investments report (`soi.tsv` at the archive root) has
no documented natural key, can carry several `ddate` values in one filing, and includes
undocumented cost and fair-value labels (Q14). Phase 1 already defined
`obs.soi_row_observation`, position observations, field values, and source-column mappings.
This phase lands SOI rows into that model without resolving borrowers, instruments, or
authoritative cost and fair value.

## Decision

- **`npm run soi:load` is a second offline loader.** It requires the ZIP to already be
  `LOADED` by `pipeline.registry_load`. Processing is keyed by
  `ops.artifact_processing (artifact_id, pipeline.soi_load)`, so SUB and SOI loads of the
  same artifact coexist.
- **Identity is location.** Every physical line is stored in `raw.tabular_row`. One
  `obs.soi_row_observation` is created per OK line whose `adsh` matches an existing
  `registry.filing`. Duplicate accession/identifier/`ddate`/`qtrs` groups remain separate
  rows. They are counted, not merged.
- **Dates are not collapsed.** Every `ddate` is stored. `period_role` stays `UNRESOLVED`
  (Q6). Current-holdings selection is not performed.
- **Filing linkage is the `adsh` cell only.** The accession-number prefix is never a
  registrant CIK. Missing accessions are quarantined as `ORPHAN_ADSH`. SOI `cik` is
  compared to explicit filing-registrant links; disagreements are `FAIL` validations and
  do not create links.
- **Q14 columns are projected as observed field values** under the existing
  `OPEN_QUESTION` mappings. Authority remains `PROVISIONAL`. They cannot feed derived
  values. Preset Cost/Fair Value cells that are empty produce no field-value row
  (Unknown, never zero). NUM is not ingested; currency stays `UNKNOWN`.
- **Header policy.** The first 21 labels must match the documented preset list in order.
  Extra dynamic columns are kept. A preset mismatch is `SCHEMA_DRIFT` and stops the load.
  A 0-byte `soi.tsv` is stored as a table load with an empty header and `EMPTY_PERIOD`
  coverage (P3-D11a).
- **Coverage aspect `SOI_HOLDINGS`** is independent of `FILING_METADATA`. Missing holdings
  are never recorded as zero exposure.

## Consequences

- Entity, instrument, economic-group, and position-continuity resolution remain later
  phases.
- Authoritative cost and fair value require a reviewed mapping supersession for Q14 and/or
  a documented NUM join, neither of which is done here.
- Local `npm run soi:reconcile` can compare store line counts to database counts. CI stays
  network-free and uses synthetic fixtures only.
