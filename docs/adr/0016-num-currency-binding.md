# 0016. NUM ingestion and SOI currency binding

## Status

Accepted

## Context

SOI has no unit column. Phase 3 (ADR 0012) therefore lands monetary position field values
with `currency_state = UNKNOWN` and a null `currency_code`. Period-comparison deltas require
compatible stored currency codes (migration 0059) and must not invent USD from the issuer or
convert currencies.

`docs/SOURCE_SCHEMAS.md` §5.4 records an **observed, undocumented** join from SOI monetary
cells to NUM facts on accession, reporting date, and Investment Identifier Axis typed member,
with value agreement against the expected standard tags. The schema already includes
`obs.num_fact_observation`, `obs.field_value_corroboration`, and the vocabulary value
`FROM_NUM_UNIQUE_MATCH`. NUM was deferred in ADR 0012.

## Decision

- **`npm run num:load` is a third offline loader.** It requires the ZIP to already be
  `LOADED` by `pipeline.registry_load`. Processing is keyed by
  `ops.artifact_processing (artifact_id, pipeline.num_load)`. Identity is location
  (`raw.table_load` + line number). The documented NUM header
  (`adsh, tag, version, ddate, qtrs, uom, segments, dimn, value, footnote, footlen`) must
  match exactly; otherwise the load is `SCHEMA_DRIFT` and stops. `ddate` is `YYYYMMDD`.
  Filing linkage is the `adsh` cell only. Identifier members are parsed from `segments` by
  the projection rule version (typed `Axis(version)=text()` form, plus the abbreviated
  `Axis=text` form used in fixtures).
- **`npm run num:bind-currency` binds currency only.** It considers current heads for
  `PRINCIPAL_AMOUNT`, `COST`, and `FAIR_VALUE` that are `REPORTED` with
  `currency_state = UNKNOWN`. A successor is written only when NUM facts for the same
  filing, reported date, and identifier member include a unique ISO-4217 alphabetic `uom`
  among facts whose tag is the expected standard tag for that field and whose
  `value_numeric` equals the field's `normalized_numeric`. The successor keeps the prior
  raw and normalized amount, sets `currency_state = FROM_NUM_UNIQUE_MATCH` and the ISO
  code, cites `supersedes_id`, and records `field_value_corroboration` with outcome
  `EQUAL` and `join_basis = OBSERVED_UNDOCUMENTED`.
- **Fail closed.** Zero match leaves the head unchanged. Multiple incompatible currencies
  or ambiguous key matches leave currency unresolved and may record `MULTIPLE_CANDIDATES`.
  A unique key match with a different value records `NOT_EQUAL` and does not promote.
  Non-ISO or non-currency units do not promote. Issuer identity, amount size, and
  filing-level defaults never supply currency. No FX conversion.
- **Append-only and idempotent.** Prior heads and evidence remain. Reruns do not duplicate
  facts, corroborations, or supersession chains. Q14 cost/fair-value mapping status is
  unchanged; currency enrichment does not elevate mapping authority.
- **The period-comparison currency gate is unchanged.** Compatible coded currencies remain
  required for `COMPARABLE` monetary deltas.

## Consequences

- Local synthetic ZIPs used for pipeline tests must include `datasets/num.tsv` when NUM
  load or currency bind is under test.
- Hosted remediation is a separate, explicit operation; this ADR does not authorize Hosted
  writes.
- HTML/iXBRL unit extraction remains out of scope here.
