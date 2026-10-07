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
| 0.11 | 2026-10-07 | `resolution.entity_exact_company_cell_name` v1: legal entities come only from the primary-filing company cell or SOI `ISSUER_NAME`; Identifier Axis text is never a legal-entity name |
| 0.12 | 2026-10-07 | `norm.instrument_type_footnote_ref` v1: trailing footnote markers on an HTML-cell instrument type are removed only when verified against row-linked Inline XBRL footnotes; P7 rules v2 use it for same-registrant, exact-identifier continuity only |
| 0.13 | 2026-10-07 | `resolution.position_approved_continuity_supersession` v1: explicit historical correction that supersedes three audited run-49 continuity decisions; run 49 stays immutable; no automatic supersession |

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
4. Continuity is `MATCHED` only for the same `registry.current_filing_registrant` `LINKED` registrant, a `MATCHED` instrument, the exact same identifier text, and the same continuity type text. Version 2 of the four P7 rules takes the continuity type text from `norm.instrument_type_footnote_ref` v1 (7.7): the verified text when `VERIFIED`, otherwise the raw type unchanged. Version 1 keyed continuity on registrant and instrument, which is the same key whenever no marker is removed. Method `SAME_REGISTRANT_AND_INSTRUMENT`, or `SAME_REGISTRANT_IDENTIFIER_AND_FOOTNOTE_VERIFIED_TYPE` when the observation's own type was verified. Different BDCs never share an `identity.position`.
5. If the instrument or the filing registrant is not uniquely established, continuity is `UNRESOLVED` with no `position_id`. If existing `MATCHED` continuity already names more than one position for the same key, the new observation is `UNRESOLVED`, method `AMBIGUOUS_EXISTING_SERIES`; no series is chosen and the existing decisions are not changed.
6. Dates with no observation in a series are not observed. They are not written as zero principal, cost, or fair value.

### 7.6 `resolution.entity_exact_company_cell_name` v1

Applies to the bounded eligible-instrument resolution (`pipeline/resolve-eligible-instruments.mjs`), which uses this rule instead of 7.4. The `Investment, Identifier Axis` text can combine the company name and instrument text (Q5 in `docs/SOURCE_SCHEMAS.md`), so it is not a legal-entity key (G-14, G-15).

1. Company-name sources are the current `EXTRACTED` `FILING_CELL` name from the primary filing's company cell and the current `REPORTED` SOI `ISSUER_NAME` field after `norm.borrower_name` v1. Both have equal standing.
2. Identifier Axis text is never stored as a legal-entity name or alias and is never split, trimmed of instrument words, or otherwise rewritten to produce one.
3. One distinct company name gives `MATCHED`, method `EXACT_COMPANY_CELL_NAME`, actor `SYSTEM_RULE`. The legal entity is the one whose `VERIFIED` alias from this rule equals the name exactly; when there is none, one `identity.legal_entity` is created with the name as its `VERIFIED` alias. The decision cites the company-name evidence.
4. No company name gives `UNRESOLVED`, method `NO_COMPANY_NAME_EVIDENCE`, with no legal entity. The decision cites the identifier name evidence.
5. Company names that disagree give `UNRESOLVED`, method `CONFLICTING_COMPANY_NAMES`. A name equal to the alias of more than one legal entity gives `UNRESOLVED`, method `AMBIGUOUS_COMPANY_NAME`.
6. Near-name, suffix, case, fuzzy, and LLM matches are never `MATCHED`. Names that differ in any character are different aliases.
7. An identical identifier at several registrants is not evidence of one legal entity. Without a company name each observation stays `UNRESOLVED`.
8. The decision is recorded on the observation's single current Identifier Axis name row, so `registry.matched_entity_position` and `registry.position_read` attach a legal entity only to `MATCHED` observations.
9. Decisions are insert-only. An observation whose identifier name already has a current decision is skipped; company evidence stored later does not update that decision. Changing it requires an explicit superseding decision with a reason.

### 7.7 `norm.instrument_type_footnote_ref` v1

Some filers print footnote references after the instrument type in the schedule cell, for example `First Lien(2)(6)(8)` in one period and `First Lien(2)(5)` in the next. The markers change between periods while the disclosed type does not. This rule removes such markers only when the filing itself proves they are footnote references. Sources: Inline XBRL Part 1: Specification 1.1, Recommendation 2013-11-18 (https://www.xbrl.org/specification/inlinexbrl-part1/rec-2013-11-18/inlinexbrl-part1-rec-2013-11-18.html), sections 6 and 13.1; the EDGAR XBRL Guide; and `docs/SOURCE_SCHEMAS.md` 8.1.

1. Scope: `INSTRUMENT_TYPE` values whose evidence is an `HTML_TABLE_CELL` written by `obs.research_field.exact_disclosure_cell` or `obs.research_field.bound_context_cell`. SOI dataset values (`obs.projection.soi`) are never in scope and never changed.
2. Candidate: only a run of `(digits)` groups at the very end of the text. Whitespace between groups and before the first group belongs to the run. Parentheses that contain letters or other terms, markers in the middle of the text, attached digits such as `Class A2` or `Loan4`, and text with trailing whitespace after the last group are not candidates. Case and other spacing are never changed.
3. Verification uses the stored filing document named by the type value's own evidence (artifact checksum verified on read) and the recorded 1-based table row. A marker `(n)` is verified only when:
   1. a cell on that row has exactly the stored raw type text;
   2. an `ix:relationship` links at least one Inline XBRL fact on that row to an `ix:footnote`, where the relationship has no `arcrole` (Inline XBRL 1.1 default, http://www.xbrl.org/2003/arcrole/fact-footnote) or has exactly that arcrole;
   3. exactly one of the `ix:footnote` elements linked from that row carries the visible label `(n)`. The label is the text ending immediately before the `ix:footnote` element. This placement is a filing presentation convention, not an XBRL requirement, so it is only trusted after the row link in (2). Uniqueness is checked among the footnotes linked from the row, not the whole document, because filers reuse the same label for different footnotes in one document (`docs/SOURCE_SCHEMAS.md` 8.1).
4. If every candidate marker is verified the state is `VERIFIED` and the normalized text is the text before the run (`First Lien(2)(6)(8)` gives `First Lien`; `First lien (2)(3)` gives `First lien`). If any marker fails, the state is `UNVERIFIED` and the whole text is kept unchanged. Reasons: `DOCUMENT_UNAVAILABLE`, `ROW_NOT_FOUND`, `TYPE_CELL_NOT_IN_ROW`, `NO_ROW_FACTS`, `MARKER_NOT_LINKED`, `AMBIGUOUS_MARKER_LABEL`, `NOTHING_LEFT_AFTER_MARKERS`. Values with no candidate are `NO_CANDIDATE`; values outside scope are `NOT_APPLICABLE`.
5. Fail closed: an unverifiable marker is never removed. The stored `INSTRUMENT_TYPE` field value is never rewritten.
6. Use is limited to P7 continuity within one LINKED registrant and the exact identifier text (7.5). Instrument identity (`EXACT_IDENTIFIER_AND_TYPE`) still uses the raw type, so cross-BDC instrument identity is unchanged and this rule never merges instruments or series across BDCs.
7. The raw type, normalized type, removed markers, footnote ids, and state with reason are recorded in the rationale of each new continuity decision whose type had a candidate run, and in the dry-run plan of `pipeline/resolve-eligible-instruments.mjs`. No schema change is needed: `identity.position` has no instrument column.
8. Existing decisions are not updated. Observations decided under the version 1 P7 rules keep their decisions, including series that version 2 would key together. Replacing them requires explicit superseding decisions with a reason, which this rule does not create. The only such replacement is the approved correction in 7.8.

### 7.8 `resolution.position_approved_continuity_supersession` v1 (historical correction)

This is an explicit, approved historical correction. It is not P7 resolution: the P7 writer and `pipeline/resolve-eligible-instruments.mjs` never run it and never supersede an existing decision. It runs only through `npm run continuity:supersede-approved` (`pipeline/supersede-approved-continuity.mjs`).

Run 49 decided continuity under the version 1 P7 rules, which keyed on the raw instrument type. Three later observations whose raw types differ from the earlier observation only in verified trailing footnote markers (7.7) were therefore placed in their own positions. A read-only evidence audit classified these three pairs as the same position in consecutive periods:

| Later observation | Earlier observation | Registrant (CIK) | Exact identifier | Run 49 decision superseded | Target position (earlier observation's) |
| --- | --- | --- | --- | --- | --- |
| 893583 (2024-09-30) | 981407 (2024-06-30) | 1925531 | `Geo Parent Corporation, First Lien 1` | 1 | `4800a33c-eef6-47dc-a139-a038680ad3f5` |
| 893584 (2024-09-30) | 981408 (2024-06-30) | 1925531 | `Geo Parent Corporation, First Lien 2` | 3 | `f852d4f5-73b2-4082-8b23-78ee2ba5f443` |
| 893587 (2024-09-30) | 981411 (2024-06-30) | 1766037 | `Geo Parent Corporation, First Lien` | 5 | `d4b6ef3b-c03b-4615-8178-3ed688b0eb2d` |

1. The allowlist is frozen in `pipeline/normalize/continuity-supersession.mjs` and is part of the rule checksum. The command takes no pair arguments. Changing a pair requires a new rule version and a new approval.
2. Each entry pins the later and earlier observation ids, the exact identifier text, the registrant CIK, both reported dates, the run 49 decision id and run, and the target position. A pair is applied only when every pinned fact equals the stored fact and:
   1. both observations have one LINKED registrant, the same registrant, and the pinned CIK;
   2. both SOI identifiers and identifier-name observations are exactly the pinned text;
   3. both current `INSTRUMENT_TYPE` values are `VERIFIED` under `norm.instrument_type_footnote_ref` v1 (re-verified from the stored filing documents at run time) with equal continuity type text;
   4. both have a current `MATCHED` instrument decision;
   5. the later observation's current decision is the pinned run 49 `SAME_REGISTRANT_AND_INSTRUMENT` decision, and its position has no other current member;
   6. the earlier observation is currently `MATCHED` to the target position, and no other member of that position is dated on or after the earlier date;
   7. no other observation of the same registrant and exact identifier is dated between the two dates or on either date (the no-skipped-middle rule of `registry.position_period_comparison`).
   Any failure blocks the whole operation; nothing is written.
3. For each pair it inserts one `resolution.match_candidate` (`POSITION`, later observation, target position) with three `AGREE` comparisons that carry the earlier and later evidence ids (`REGISTRANT_OBSERVATION`: SOI row evidence; `IDENTIFIER`: identifier-name evidence; `FOOTNOTE_VERIFIED_TYPE`: HTML type-cell evidence), and one `resolution.position_continuity_decision`: `MATCHED`, method `APPROVED_SUPERSESSION_SAME_REGISTRANT_IDENTIFIER_AND_FOOTNOTE_VERIFIED_TYPE`, the target position, the candidate, `supersedes_id` set to the run 49 decision, a `supersede_reason`, a rationale that lists the raw and verified types, removed markers, footnote ids, instrument ids, and evidence ids, the later observation's SOI evidence, this rule's `ops.rule_version` row (with its checksum), and a new `APPROVED_CONTINUITY_SUPERSESSION` run.
4. Run 49 is immutable. Its decisions are never updated or deleted; each superseded decision stays in history and is no longer current only because a later row names it in `supersedes_id`. Instrument decisions are not touched, so the two observations of each pair keep their separate instruments (instrument identity still uses the raw type). No `identity.position` row is inserted or changed; the later observation's former position simply has no current member.
5. Idempotent: a pair whose current decision already supersedes the pinned decision with this method is reported as already applied. When nothing is planned, no run is created and nothing is written. The database also refuses a second superseding row for one decision.
6. The SOFR(S) to SOFR(Q) reference-rate reset frequency change seen in all three pairs is not treated as an identity change for this approved correction, because reset frequency is not part of the approved identity key. Whether it should be is a separate methodology question.
7. Not linked: the earlier Guardian IV `Geo Parent Corporation, First Lien` series ending 2024-03-31 (observations 893588, 981412, 1067071, 1146287, 1067072) has no evidence connecting it to First Lien 1 or First Lien 2. Those observations and 1146289 and 1067074 are protected: any allowlist naming them is refused.
8. No automatic future supersession: no other observation is superseded, and the P7 resolver does not create superseding decisions.
9. A hosted database is refused unless `--allow-hosted` is passed. `--dry-run` only reads and prints the planned supersessions.

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
