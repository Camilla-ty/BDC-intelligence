# 0019. Quoted TSV recovery for SEC NUM extra-tab rows

## Status

Accepted

## Context

NUM TSV is ingested by naive tab split. Header width is 11. `docs/SOURCE_SCHEMAS.md`
§4.8 and discrepancy 15 treated extra tabs as malformed for every table.
`raw.check_tabular_row` requires `parse_status = OK` iff naive `field_count` equals
header width. `obs.check_row_projection` allows NUM facts only from OK rows.

Hosted August 2026 NUM load Run 72 stored 23 `FIELD_COUNT_MISMATCH` exceptions
(IDs 67–89). Those rows must not be rewritten (G-10). A comparison helper can recover
11 cells from syntactically valid quoted TSV. Filing corroboration showed that the
recovered identity of those rows corresponds to tagged iXBRL facts. Corroboration
does not ingest Run 72 rows.

ADR 0016 remains the NUM loader-identity and currency-bind decision. This ADR amends
NUM parse and projection policy only.

## Decision

### Policy (D1–D12)

These are confirmed. They are not reopened by implementation.

- **D1** Recover only valid quoted TSV whose extra tabs are inside quoted fields.
  Unquoted extra tabs and invalid quoting remain quarantined.
- **D2** Preserve `raw_line` and naive `field_count`. Store recovered cells and
  recovered width separately.
- **D3** Parse status `QUOTED_RECOVERY`. Do not change the meaning of `OK` or
  `FIELD_COUNT_MISMATCH`.
- **D4** Restricted projection only for validated recovered rows on **future** loads.
  No retroactive projection of existing rows, including Hosted Run 72 exceptions
  67–89 as stored.
- **D5** The source identifier member is the quoted NUM `segments` typed-member text
  exactly. Do not trim tabs or normalize whitespace.
- **D6** Project only if `footlen` equals the UTF-8 byte length of the unquoted
  footnote text, or the footnote is empty with `footlen` 0. Otherwise keep recovery
  diagnostics and block projection.
- **D7** NUM only. Do not change SOI or TXT parsers or extra-field treatment.
- **D8** Append-only new catalog versions. Never rewrite stored hashes or old
  version semantics.
- **D9** Leave Hosted Run 72 unchanged. No replay or reload.
- **D10** Preserve `raw_line`, naive parse results, and recovered cells as three
  representations.
- **D11** Recover only syntactically valid quote syntax (closed quotes, no mid-field
  quote, no text after the closing quote). Invalid syntax remains quarantined.
- **D12** Currency binding remains separate (ADR 0016). Do not infer USD from the
  issuer. Do not run `num:bind-currency` as part of this change.

Fact-level iXBRL corroboration of exceptions 67–89 does not authorize ingestion of
those stored rows.

### Approved schema mechanics

These five items are confirmed design, not recommendations:

1. Recovered NUM cells live in a separate `raw.num_quoted_recovery` sidecar table,
   not in `raw.tabular_row.cells`.
2. Two migrations: first `ALTER TYPE ref.parse_status ADD VALUE 'QUOTED_RECOVERY'`;
   then constraints, sidecar, triggers, and exception kind in a second file
   (PostgreSQL cannot use a newly added enum value as a typed literal in the same
   transaction).
3. New `ops.projection_exception.kind` value `FOOTLEN_MISMATCH` for recovered rows
   blocked by D6. Do not use `FIELD_COUNT_MISMATCH` for those rows.
4. `raw.table_load.field_count_mismatch_count` continues to count naive width ≠
   header width, including `QUOTED_RECOVERY` rows.
5. Projection from recovered cells is permitted only when D6 and every existing NUM
   validation pass.

`OK` remains exactly the case where naive `field_count` equals header width.
`QUOTED_RECOVERY` requires naive width ≠ header width, table code NUM, and a sidecar
row. `FIELD_COUNT_MISMATCH` remains unquoted extra tabs and invalid quoting.

Cell source for NUM labels: `OK` uses `raw.tabular_row.cells`; `QUOTED_RECOVERY`
uses `raw.num_quoted_recovery.recovered_cells`; `FIELD_COUNT_MISMATCH` is not a
projection source. Global `obs.cell_by_label` (naive `cells`) is not widened for
SOI.

### Relationship to ADR 0016

ADR 0016 stays Accepted for `num:load` identity (location), the documented
11-column header, `adsh` filing linkage, fail-closed currency bind, and the rule
that ADR 0016 does not authorize Hosted writes. This ADR does not supersede 0016
and does not change bind rules.

### Recommendations (not confirmed schema names beyond the sidecar and kinds above)

- A deferred constraint trigger so a `QUOTED_RECOVERY` row cannot commit without a
  sidecar.
- A NUM-only cell reader for recovered projection (do not change `obs.cell_by_label`).
- Insert parent `raw.tabular_row` then the sidecar in one transaction on future loads.
- Do not re-implement quoted-TSV splitting in SQL.
- Do not store a `projection_eligible` flag; evaluate D6 at projection time.
- Bump `pipeline.num_load` only if its listed files change; otherwise leave the
  current version. Skip-on-`LOADED` for any version of that rule code remains
  (this implements D9).

### Unresolved until implementation

- Migration file numbers, catalog version integers, and definition SHA-256 values.
- Whether `pipeline.num_load` files actually change.
- Whether recovered T1 identifier members (NUM omits a trailing tab present in
  filing `text()`) will byte-equal SOI identifiers or satisfy ADR 0016 bind keys.
  Measure only. Do not trim to force a join.
- Hosted replay of Run 72 (requires a later explicit approval; not this ADR).

## Consequences

- Implementation must not start by rewriting Run 72 rows or by marking recovered
  rows `OK`.
- Parser and projection catalog versions must be added together as new append-only
  pairs. Stored `parser.sec_num_tsv` v2, `obs.projection.num` v2, and
  `pipeline.num_load` v3 semantics and hashes stay as stored.
- `docs/DATA_MODEL.md` is updated after the migrations exist, not before.
- SOI/TXT extra-field rows stay malformed under discrepancy 15.
- Currency bind is not part of this change. Exact identifier preservation may cause
  fail-closed zero matches on T1 members; that is accepted, not a parser bug.
- This ADR does not authorize Hosted writes, `num:load` of August 2026, or
  `num:bind-currency`.
