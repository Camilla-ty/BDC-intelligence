# Methodology

**Status:** principles plus the Phase 3 registry, filing-history, and raw SOI methodology,
P4-min borrower-name / instrument-type rules, P5-min filing-document string checks,
P6-min legal-entity resolution, P7-min instrument identity plus per-registrant
continuity, the Phase 8 Golden Borrower Gate, and P9-min registrant-first-observed events
for the golden slice.
Concrete definitions (formulas, thresholds, signal rules) are added in the phases that
implement them. The database structure that enforces these principles is described in
[DATA_MODEL.md](DATA_MODEL.md). The ingestion pipeline is described in
[ADR 0011](adr/0011-registry-ingestion.md) and [ADR 0012](adr/0012-soi-ingestion.md).

## 1. Versioning

- Every normalization rule, resolution rule, derived-metric definition, and signal
  definition carries a version identifier.
- Outputs record the versions that produced them, so any figure can be reproduced.
- A definition change creates a new version; outputs from earlier versions remain queryable.

### Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-09-28 | Initial skeleton: principles and structure only |
| 0.2 | 2026-09-28 | Value states confirmed; confidence vocabulary settled; authority classes and coverage states defined for the Phase 1 schema |
| 0.3 | 2026-09-28 | Phase 2: coverage aspects (filing metadata vs filing history); fetch/load split; UNRESOLVED amendment decisions; observed fields remain labeled observed |
| 0.4 | 2026-09-28 | Phase 3: SOI_HOLDINGS coverage; raw SOI identity by location; Q14 cost/FV remain provisional observed fields |
| 0.5 | 2026-09-29 | P4-min: `norm.borrower_name` v1 and `norm.instrument_type` v1 (golden slice only) |
| 0.6 | 2026-09-29 | P5-min: `validation.golden_filing_string` v1 exact-string filing checks (golden slice only); Q14 remains OPEN |
| 0.7 | 2026-09-29 | P6-min: `resolution.entity_exact_normalized_name` v1 and `resolution.entity_near_name_candidate` v1 (golden slice only) |
| 0.8 | 2026-09-29 | P7-min: instrument exact-identifier-and-type MATCHED; unknown type UNRESOLVED; per-registrant continuity (golden slice only) |
| 0.9 | 2026-09-30 | Phase 8 Golden Gate: `derived.golden_observation_count` v1; Q14 remains OPEN; unknown instrument type stays UNRESOLVED |
| 0.10 | 2026-09-30 | P9-min: `event.registrant_first_observed_name` v1; other event types stay blocked |

## 2. Source hierarchy

1. **Original SEC/EDGAR filing:** authoritative evidence for what a registrant disclosed.
2. **Structured SEC datasets:** a scalable ingestion layer derived from filings. Useful for
   bootstrap and scale, but not a substitute for the filing. Important facts are validated
   against the filing.
3. **Derived analytics:** our own reproducible calculations over normalized observations,
   always labeled as derived.
4. **LLM output:** never a source of financial facts, identity decisions, or arithmetic.

Which SEC endpoints, files, and fields are used is documented, with official citations,
in [SOURCE_SCHEMAS.md](SOURCE_SCHEMAS.md).

## 3. Value states

Every value has an explicit state (confirmed in Phase 1):

| State | Meaning |
| --- | --- |
| Reported | Taken from a source document, with provenance |
| Derived | Calculated by versioned deterministic code from reported values |
| Unknown | Not disclosed, not available, or not supported by evidence |
| Not applicable | The concept does not apply to this record |

Unknown is a valid value. It is never replaced with zero, a blank, or an estimate. A reported
zero is recorded only when the source text itself is a zero. A field with no recorded value is
Unknown.

## 4. Confidence, evidence, and resolution vocabularies

Settled in Phase 1; the separate "data confidence" scale proposed earlier is not used.

- **Resolution state** (entity, economic group, instrument, position continuity, and other
  sameness decisions): MATCHED, PROBABLE, UNRESOLVED, REJECTED. A decision's confidence
  classification is its resolution state. Ambiguous cases are UNRESOLVED.
- **Evidence status** (whether a structured-data value was checked against the filing): not
  checked, data set only, filing verified, filing mismatch, unverifiable.
- **Authority** (computed from value state, evidence, evidence status, and column-mapping
  status; never stored):

| Authority | Meaning |
| --- | --- |
| Authoritative | Supported by the original filing (Level 2 evidence or a filing-verified check) |
| Reported (structured) | From a documented structured-data column, not yet checked against the filing |
| Provisional | Depends on an undocumented column meaning or an undocumented join; shown only with that label and never used in derived values |
| Unresolved | Conflicting or unresolved source meaning (for example a filing mismatch or unresolved scale) |
| Unknown | No usable value, including fields that require the filing when only structured data exists |
| Not applicable | The concept does not apply |

Undocumented source columns (the "Adjusted cost basis" and "Initial fair value of
Investment" columns among them) stay provisional until a reviewed, documented mapping
replaces their open-question status.

## 5. Coverage and missing data

- Coverage (which registrants and which periods are included) is tracked explicitly with the
  states covered, empty period, not ingested, not in scope, and unknown, and with an aspect
  (`FILING_METADATA`, `FILING_HISTORY`, or `SOI_HOLDINGS`). SOI holdings coverage is never
  inferred from filing-metadata coverage.
- A scope with no coverage record has unknown coverage. Only "covered" counts as covered.
- A missing period, filing, registrant, or field is shown as missing coverage.
- Missing coverage is never interpreted as zero exposure.
- Aggregates state the coverage they are computed over.

## 6. Identity layers

Identity is modeled in separate layers, each resolved independently:

1. **Registrant:** the SEC filing entity, identified by CIK. CIK is used only at this layer.
2. **Raw observation:** a disclosed row, stored exactly as disclosed and never modified.
3. **Legal entity:** a verified legal entity, which may appear under several disclosed names.
4. **Economic group:** related legal entities. Never inferred from name similarity alone.
5. **Instrument:** a specific loan, tranche, or security. The same borrower does not imply
   the same instrument.
6. **Position observation:** a registrant's holding of an instrument in a reporting period.

Resolution decisions record state (which is the confidence classification), method,
evidence, reason, and rule version, and are versioned rather than overwritten.

A registrant is linked to a filing only from explicit filing metadata. The accession-number
prefix identifies the submitter, not the registrant, and is never used for this. Phase 2
records every `/A` filing as an UNRESOLVED amendment with no target; it does not match
amendments.

A SOI row is one physical line of `soi.tsv`. Duplicate disclosed keys stay as separate
observations. Selecting "current holdings" from the dates in one filing remains OPEN
QUESTION Q6; Phase 3 leaves `period_role` UNRESOLVED.

## 7. Normalization

- Normalization is deterministic and versioned.
- The raw value is always retained alongside the normalized value.
- Normalization is never performed by an LLM.

### 7.1 `norm.borrower_name` v1

Applies to `obs.borrower_name_observation` (P4-min golden slice; not a universe-wide SOI rewrite).

1. Store `raw_text` exactly as disclosed (`Investment, Identifier Axis`, and a separate row for a REPORTED `ISSUER_NAME` field when one exists).
2. `normalized_text` is Unicode NFC of `raw_text` with ASCII leading/trailing spaces removed (`btrim`). Internal spaces, case, punctuation, and legal-suffix spelling are unchanged.
3. If that result is empty, `extraction_state = UNRESOLVED` and `normalized_text` is omitted.
4. Otherwise `extraction_state = EXTRACTED`.
5. v1 does not case-fold, collapse internal whitespace, map Inc/Corp/LLC, split name from instrument text (Q5), fuzzy-match, or merge rows that share a normalized form.

### 7.2 `norm.instrument_type` v1

The documented instrument-type vocabulary is the disclosed `Investment Type Axis` member (SOURCE_SCHEMAS 5.1). v1 does not invent Debt/Equity/loan buckets or seniority.

- Non-empty disclosed member: REPORTED; mapped text equals the member string.
- Missing or empty member: UNKNOWN.

### 7.3 `validation.golden_filing_string` v1

Applies to the P5-min golden slice only. It does not rewrite SOI rows or field values.

1. Fetch the `registry.filing_document.document_url` already stored for Golden accessions. Do not construct SEC URLs.
2. Store HTTP 200 bodies as `raw.artifact` (`SEC_FILING_DOCUMENT`) with source URL, retrieval time, and checksum; link `registry.filing_document_artifact`; create `L2_ORIGINAL_FILING` evidence with locator `DOCUMENT` (whole-document search, not an iXBRL fact or HTML anchor). HTTP 404 is recorded in the fetch log without an artifact.
3. Search each Golden identifier `raw_text` and each current REPORTED economic `raw_value` as an exact substring of the fetched bytes as UTF-8, after HTML-entity decode, and after tag strip. The needle is not whitespace-collapsed, not split on `|`, and not rewritten by an LLM.
4. String present: `PASS` plus `FILING_VERIFIED` (field values) or a name `PASS` on `obs.borrower_name_observation`. String absent: `FAIL` plus `UNVERIFIABLE` (the document is in hand but this method cannot extract a contradicting filing value, so `FILING_MISMATCH` is not asserted). Document unavailable: `NOT_EVALUATED` plus `UNVERIFIABLE`, with no Level 2 evidence claim.
5. Dataset values stay as disclosed. Q14 columns remain `OPEN_QUESTION` / `PROVISIONAL` and must not enter `derived.derived_value_input` even when the raw string is present in the filing.

### 7.4 `resolution.entity_exact_normalized_name` v1 and `resolution.entity_near_name_candidate` v1

Applies to the P6-min golden slice only. It does not resolve the SOI universe, does not assign CIK to identity rows, and does not create an economic group from name similarity.

1. One `identity.legal_entity` is created for the Golden identifier. The disclosed `normalized_text` is stored as a `VERIFIED` `identity.legal_entity_alias`.
2. `MATCHED` is allowed only when `obs.borrower_name_observation.normalized_text` is exactly equal after `norm.borrower_name` v1 (NFC + btrim). Method `EXACT_NORMALIZED_NAME`, actor `SYSTEM_RULE`. Fuzzy, LLM, and suffix-stripping matches are not MATCHED.
3. A near-name (core tokens equal after dropping a versioned corporate-suffix / Holdco list, suffixes differ) creates a `resolution.match_candidate` (`LEGAL_ENTITY`) with `NORMALIZED_NAME` `DISAGREE`, and an `UNRESOLVED` decision with no `legal_entity_id`. Method `NEAR_NAME_CANDIDATE`. It is never merged into the Golden entity.
4. Economic-group membership is not written unless a later phase has explicit disclosed affiliation evidence.

### 7.5 P7-min instrument identity and per-registrant continuity

Applies to the P7-min golden slice only. It does not scan the SOI universe, does not assign CIK to identity rows, and does not derive COST or fair value.

1. `MATCHED` instrument identity requires the `obs.borrower_name_observation` identifier after `norm.borrower_name` v1 and a non-empty `REPORTED` `Investment Type Axis` member (`INSTRUMENT_TYPE`). Method `EXACT_IDENTIFIER_AND_TYPE`, actor `SYSTEM_RULE`. The legal entity is not used as an instrument key (G-14, G-15).
2. Missing or empty type is `UNKNOWN`. The decision is `UNRESOLVED` with no `instrument_id`. Method `UNKNOWN_INSTRUMENT_ATTRIBUTES`. Fuzzy, LLM, seniority, and secured flags are not inferred.
3. Distinct identifier strings are distinct instruments, including two loans of the same borrower.
4. Continuity is `MATCHED` only for the same `registry.current_filing_registrant` `LINKED` registrant and the same `MATCHED` instrument. Method `SAME_REGISTRANT_AND_INSTRUMENT`. Different BDCs never share an `identity.position`.
5. If the instrument or the filing registrant is not uniquely established, continuity is `UNRESOLVED` with no `position_id`.
6. Dates with no observation in a series are not observed. They are not written as zero principal, cost, or fair value.

Further normalization rules will be added in later phases.

## 8. Derived metrics

Each derived metric will be documented with: definition, inputs, applicability, handling of
Unknown inputs, rounding and precision, and version.

### 8.1 `derived.golden_observation_count` v1

Applies to the Phase 8 Golden locator set only. It is not COST, fair value, or any Q14 valuation.

| Item | Definition |
| --- | --- |
| Definition | Count of distinct `obs.position_observation.id` values in the committed Golden locator list. |
| Inputs | The locator `position_observation_id` values. Independently recomputed as `count(*)` of those ids in `obs.position_observation` and of matching `obs.borrower_name_observation` rows. |
| Applicability | Golden Gate only. Empty or invalid ids are refused; they are not counted as zero. |
| Unknown inputs | An invalid id is an error, not 0. Missing coverage (a registrant×date with no locator) is not an input and is not counted. |
| Rounding | Integer count. No currency. |
| Version | `1` |

**ENGINEERING DECISION:** the count is stored on the Golden Gate run outcome and in `.data/validation/golden/golden_gate.json`. It is not inserted into `derived.derived_value`, because that table only accepts `field_value_id` or another derived value as inputs, and an observation-row count is not a field value. Inventing field-value inputs would violate G-01 / G-07.

Q14 COST and fair value remain `OPEN_QUESTION` and must not feed `derived.derived_value_input`.

## 9. Events and signals

Each event or signal is documented with: the observable condition that triggers it,
its inputs, the evidence it links to, and its version. Signals are individual, explicit
observations; they are not combined into scores.

### 9.1 `event.registrant_first_observed_name` v1

Applies to an explicit observation list (the Golden locators in P9-min). It does not scan the SOI universe.

| Item | Definition |
| --- | --- |
| Condition | Among observations in the list whose filing registrant is `LINKED`, keep those whose `reported_date` equals the earliest `reported_date` for that registrant. |
| Inputs | `position_observation_id`, `reported_date`, `evidence_id`, and the LINKED registrant id used only to group. Amounts, instrument identity, COST, and fair value are refused. |
| Evidence | `derived.observation_event.evidence_id` must equal `obs.position_observation.evidence_id`. `reported_date` must equal the observation date. |
| Unknown inputs | A missing registrant link is skipped. A date that is not in the list is not an event and is not zero exposure. |
| Version | `1`. Unknown-input policy: `REJECT_UNKNOWN_INPUTS`. |

The following event types are **BLOCKED** for this slice and are not stored:

| Code | Why it is blocked |
| --- | --- |
| `NEW_POSITION` | Instrument identity is UNRESOLVED |
| `EXPOSURE_INCREASE`, `EXPOSURE_DECREASE` | No MATCHED instrument, and COST/fair value are Q14 |
| `MATURITY_CHANGE`, `MATURITY_PROXIMITY` | `MATURITY_DATE` is not REPORTED |
| `VALUATION_MOVEMENT`, `VALUATION_DISPERSION` | Q14 remains OPEN_QUESTION |
| `NON_ACCRUAL`, `PIK` | Not REPORTED; mappings are OBSERVED_UNCONFIRMED |
| `NO_LONGER_REPORTED` | A coverage gap is not an exit |
| `ECONOMIC_GROUP_MEMBERSHIP` | Not inferred from a shared name |

## 10. What this methodology does not do

- No composite scores, grades, or opaque rankings.
- No inference of values that are not explicitly disclosed.
- No silent corrections: raw values and prior versions are preserved.
- No LLM-authored figures.
