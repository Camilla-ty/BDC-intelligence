# 0010. Observation, provenance, and authority model

## Status

Accepted

## Context

Source verification established that the SOI report has no natural key (duplicates remain
even on accession, identifier, date, and `qtrs`), that one filing carries several dates, that
the preset cost and fair-value columns are essentially empty while two undocumented columns
carry matching values, that currency is only available through an undocumented join to NUM,
and that the accession prefix identifies the submitter rather than the registrant. ADR 0005
and ADR 0006 set the principles; this ADR records how the schema implements them.

## Decision

- **Raw landing is lossless and generic.** Every tabular source line is stored once in
  `raw.tabular_row` with its exact text, checksum, and cells. It is identified by location
  (table load and line number), never by business columns.
- **Observations never merge rows.** One SOI observation per raw row and one position
  observation per SOI identifier row, per rule version. Potential sameness is a rule-versioned
  group with a resolution state.
- **Field values are narrow rows** carrying raw text, one typed normalized value, currency,
  scale, and value state, the column mapping, the rule version, and evidence.
- **Source-column mappings are versioned data.** The undocumented cost and fair-value columns
  are mapped with status `OPEN_QUESTION`. The database refuses to use any field value whose
  current mapping is not documented as an input to a derived value.
- **Authority is computed by a view**, never stored, so verification and mapping approval
  never mutate rows.
- **Registrant identity comes only from explicit filing metadata** (`SUB_TABLE`,
  `SUBMISSIONS_JSON`, `FILING_HEADER`). There is no accession-prefix column. Conflicting links
  are all kept and surfaced.
- **History is append-only**, enforced by triggers and privileges. Corrections supersede with
  a reason. "Current" is a view.
- **Coverage is explicit.** A scope without a coverage assertion has unknown coverage; only
  `COVERED` counts.
- **Confidence vocabulary:** a decision's confidence classification is its resolution state.
  No separate data-confidence column is stored for observations; value state, evidence status,
  and computed authority express it.

## Consequences

- Storage is larger than a deduplicated model; this is accepted for reproducibility.
- Every open source question can be recorded as a state (mapping status, parse status,
  resolution state, scale state) without schema changes.
- Resolving Q14 requires a reviewed superseding mapping row, after which existing field values
  become usable in derivations without being rewritten.
- Ingestion code must produce evidence and rule versions for every row it writes; the database
  rejects rows without them.
