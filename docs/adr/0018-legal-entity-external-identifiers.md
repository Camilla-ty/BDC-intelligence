# 0018. External identifiers for portfolio legal entities

## Status

Accepted

## Context

### Confirmed current state (repository evidence)

- The canonical internal Borrower ID is `identity.legal_entity.id` (UUID). Names live in
  `identity.legal_entity_alias`; that table is not an identifier registry
  (`db/migrations/0007_identity_resolution.sql`, ADR 0006, ADR 0017).
- A CIK identifies an SEC **registrant (filer)** and is stored on `registry.registrant.cik`
  as `bigint`. It is never a borrower, legal-entity, or economic-group primary key (G-09;
  ADR 0006; `docs/DATA_MODEL.md`; `db/migrations/0004_registry_filings.sql`).
- Portfolio borrower names are observed in `obs.borrower_name_observation` and linked to a
  legal entity only through append-only `resolution.entity_resolution_decision` (states
  MATCHED, PROBABLE, UNRESOLVED, REJECTED — G-13).
- Automated MATCHED resolution today is exact normalized name (and related company-cell
  rules). Near-name similarity produces candidates and UNRESOLVED decisions; it must not
  merge entities (`docs/METHODOLOGY.md`; `pipeline/normalize/entity-name-match.mjs`).
- Legal entity, economic group, instrument, and BDC registrant remain separate concepts
  (G-14, G-15). Entity consolidation (ADR 0017) is a separate, human-reviewed mapping among
  legal-entity UUIDs.
- SOI does not carry a borrower LEI (`docs/SOURCE_SCHEMAS.md`). There is no first-class
  table that stores a portfolio legal entity’s typed external identifier with scheme,
  relationship role, verification, and evidence.
- Supersession modes are defined in `ops.add_supersession` / `ops.check_supersession`
  (`db/migrations/0001_foundation.sql`): `single_chain` allows one live tip per subject
  (a second root insert for the same subject is rejected; corrections must supersede);
  `multi` allows several independent subjects to coexist. Alias history uses `multi` on
  `legal_entity_id` alone (`0007_identity_resolution.sql`).
- Consolidation writes are helper-only: SECURITY DEFINER functions call
  `resolution.assert_consolidation_writer()` against **`session_user`** membership in
  `resolution_writer`, with `SET search_path = pg_catalog, …`; direct INSERT was revoked
  from `bdc_pipeline_writer` (`0060_legal_entity_consolidation.sql`,
  `0061_legal_entity_consolidation_integrity.sql`).
- Privileges today: `bdc_pipeline_writer` has `SELECT,INSERT` on
  `identity.legal_entity` / `identity.legal_entity_alias`; `admin_reader` and
  `resolution_writer` have SELECT on those tables after consolidation migrations;
  `bdc_reader` consumes registry read functions/views, not base identity tables
  (`db/schema.snapshot.sql`).

### Problem

Researchers and matching pipelines need to attach external identifiers (for example CIK or
LEI) to portfolio borrowers when evidence supports it, without promoting a filer CIK to a
borrower’s own CIK, overloading name aliases, treating CUSIP/ISIN as legal-entity keys,
auto-consolidating entities, or claiming unmeasured Hosted coverage.

### Forces

- G-01 / G-12: evidence and provenance for material identifier assertions.
- G-04 / G-13: Unknown / Unresolved / UNKNOWN relationship remain valid.
- G-09 / G-14: filer CIK ≠ borrower identity; parent/affiliate ≠ the borrower.
- G-10 / ADR 0005: append-only corrections with supersession.
- G-11: preserve raw disclosed/retrieved values.
- ADR 0017: consolidation stays human-reviewed and separate from identifier assertion.
- G-03: do not invent SEC field semantics or unsupported normalization algorithms.

## Decision

### Canonical key

`identity.legal_entity.id` remains the only canonical Borrower ID. External identifiers are
supporting assertions, never a second master key.

### Dedicated relation

Introduce append-only:

`identity.legal_entity_identifier`

Do **not** store typed identifiers in `identity.legal_entity_alias` (names only).

CUSIP, ISIN, and similar remain **out of scope** for this table; they identify securities or
instruments (`identity.instrument` / instrument assertions), not legal entities (G-15).

### Identifier schemes (ref vocabulary)

Follow `ref.registrant_attribute` / `ref.filing_attribute` conventions
(`db/migrations/0002_vocabularies.sql`): introduce

`ref.legal_entity_identifier_scheme`

with seed rows at least `CIK` and `LEI` (code PK + description).  
`identity.legal_entity_identifier.scheme` references that table. Extensibility is a new ref
row + migration, not free text. Rationale: same pattern as other controlled codes; avoids
an ad hoc CHECK list that drifts from documentation.

### Relationship roles (MVP)

| Role | MVP? | Meaning |
| --- | --- | --- |
| `OWN` | Yes | Identifier is asserted to identify **this** legal entity |
| `PARENT` | Yes | Identifier identifies a parent of this legal entity |
| `AFFILIATE` | Yes | Identifier identifies an affiliate (not self, not necessarily parent) |
| `UNKNOWN` | Yes | Relationship to the borrower is not established |
| `FILER` | **No (FUTURE / NOT MVP)** | Deferred. Filer CIK already lives on `registry.registrant` and appears on borrower reads as holder `registrant_cik`. Storing FILER on this table without a concrete non-holder use case would duplicate registrant data and invite G-09 violations. |

A filer CIK must not be stored as `OWN` without evidence that the portfolio company **is**
that SEC registrant. Default association of “the BDC’s CIK on the same filing” to the
borrower remains forbidden (G-09).

### Proposed table shape

Conceptual columns (DDL deferred to a future migration after acceptance):

| Column | Direction | Notes |
| --- | --- | --- |
| `id` | bigint identity PK | Alias / decision pattern |
| `legal_entity_id` | uuid → `identity.legal_entity` | Required |
| `scheme` | text → `ref.legal_entity_identifier_scheme` | Required |
| `raw_value` | text NOT NULL | As disclosed / retrieved (G-11); `btrim` non-empty; **no silent rewrite** |
| `normalized_value` | text NULL | **Deferred in v1** — see Normalization |
| `relationship_role` | text CHECK | `OWN`, `PARENT`, `AFFILIATE`, `UNKNOWN` |
| `verification_state` | text CHECK | `UNVERIFIED`, `VERIFIED` (same as aliases) |
| `evidence_id` | bigint → `evidence.evidence` | See Evidence policy |
| `researcher_citation_*` | optional text trio | See Evidence policy (ADR 0017-shaped) |
| `rule_version_id` | bigint → `ops.rule_version` | **Mandatory** — see Rule versions |
| `actor_kind` | `ref.actor_kind` | Forced by helpers; not caller-chosen for VERIFIED/UNVERIFIED policy |
| `decided_by` | text NOT NULL | Attribution (human id or system label) |
| `decided_at` | timestamptz NOT NULL | |
| `run_id` | bigint → `ops.run` | Required |
| `supersedes_id` / `supersede_reason` | | Via `ops.add_supersession` |
| `recorded_at` | timestamptz | Default `now()` |

Hybrid actor columns (beyond bare aliases) are intentional: identifier assertions are
decision-like for verification and audit, while still living in `identity`.

### Rule versions (mandatory `rule_version_id`)

The implementing migration seeds (or looks up) at least:

| `rule_code` | Use |
| --- | --- |
| `identity.legal_entity_identifier.pipeline_unverified` | Pipeline UNVERIFIED assertions (`SYSTEM_RULE`) |
| `identity.legal_entity_identifier.human_review` | Human VERIFIED assertions and human withdrawals (`HUMAN_REVIEW`, `rule_kind` such as `REVIEW_PROCEDURE`) |

Helpers resolve `rule_version_id` via a stable lookup (same pattern as
`resolution.consolidation_rule_version_id()` in `0060_legal_entity_consolidation.sql`), not
by accepting an arbitrary id from the caller for policy-critical fields. Callers may still
pass evidence parameters; they must not override the forced actor/state/rule binding for
the helper they invoke.

**`run_id` binding:** Human-review helpers (verify / withdraw) create and associate their
own `ops.run` via `identity.begin_legal_entity_identifier_run` (or equivalent); callers
must not supply arbitrary human `run_id` values. Pipeline UNVERIFIED writes pass the
caller’s existing pipeline `ops.run` id, following established repository pipeline-run
conventions (same separation as consolidation human helpers vs pipeline loaders).

### Supersession subject and current view

**Chosen mode: `single_chain`.**

Exact subject columns for `ops.add_supersession`:

```text
legal_entity_id,scheme,relationship_role,raw_value
```

Rationale (aligned with `ops.check_supersession` in `0001_foundation.sql`):

- Different `raw_value` strings are **different subjects**. Each may have its own current tip.
  The design never silently equates or collapses them (no undocumented normalization).
- For a given subject, a second **root** insert is rejected; corrections and withdrawals must
  supersede the current tip with `supersede_reason` — one tip per exact raw assertion.
- Including `normalized_value` in the subject key remains deferred until a documented
  normalize rule exists.

**Current assertions:** `identity.current_legal_entity_identifier` — rows with no superseding
row (`NOT EXISTS (SELECT 1 FROM … s WHERE s.supersedes_id = t.id)`), same tip pattern as
`resolution.current_entity_resolution`.

**Fail closed:** more than one **current VERIFIED OWN** tip for the same
`(legal_entity_id, scheme)` is ambiguous **even when `raw_value` differs**. Consumers must
not pick a winner; matching must not emit MATCHED on that basis.

**Withdrawing an assertion:** insert a superseding row for the **same subject** with
`verification_state = UNVERIFIED` (or remain UNVERIFIED), an explicit `supersede_reason`,
and **evidence_id or a complete citation** (same all-or-none citation rules as Evidence
policy / `0060`). Do not DELETE or UPDATE the prior tip.

### FILER → OWN (and any role change)

**Not modeled as supersession.** Superseding rows must share subject columns
(`0001_foundation.sql`); changing `relationship_role` changes the subject.

To assert OWN when a prior PARENT/AFFILIATE/UNKNOWN (or, in future, FILER) row exists:

1. Insert a **new** OWN assertion (via the appropriate helper) with its own `raw_value`,
   evidence/citation, and attribution.
2. Optionally withdraw the prior non-OWN tip via same-subject supersession if that prior
   assertion should no longer be current.
3. Never silently rewrite role on an existing tip.

### Normalization (v1)

- **v1 defers scheme-specific normalization.** Do not implement CIK zero-padding, LEI
  checksum/uppercase, or other algorithms in this ADR.
- Writers store `raw_value` **exactly as retrieved from that evidence source** (no ad hoc
  pad/strip “for convenience”).
- `normalized_value` remains NULL in v1 writers.
- A future Accepted rule may introduce named `ops.rule_version` rows under
  `rule_kind = NORMALIZATION` **only** when backed by authoritative specifications in
  `docs/SOURCE_SCHEMAS.md` or an equivalent official citation (G-03, G-11).

### Evidence policy

Align with ADR 0017 consolidation CHECKs (`0060_legal_entity_consolidation.sql`):

- Each assertion must have **either**
  - non-null `evidence_id` → `evidence.evidence`, **or**
  - a complete researcher citation (`https` URL + non-empty title + non-empty excerpt),
- and citation fields are all-null or all-present together.

Additional rules (enforced in helpers + table CHECKs where expressible):

- Pipeline / `SYSTEM_RULE` path ⇒ `evidence_id` required; `verification_state = UNVERIFIED`.
- `verification_state = VERIFIED` ⇒ `HUMAN_REVIEW` only, via the human helper. Citation-only
  VERIFIED is allowed for humans (same as consolidation); structured `evidence_id` preferred
  when an artifact locator exists. Name-only inference cannot produce VERIFIED.
- Human **withdrawal** supersession rows are assertions too: they require the same
  evidence-or-complete-citation policy (all-or-none citation fields as in `0060` / ADR 0017).

### Write path: helper-only (PostgreSQL enforcement)

Follow consolidation’s helper-only pattern. **Do not** grant broad direct `INSERT` on
`identity.legal_entity_identifier` (or its identity sequence) to `bdc_pipeline_writer` for
convenience.

#### Table and sequence privileges

| Role | Table | Sequence |
| --- | --- | --- |
| `bdc_pipeline_writer` | `SELECT` only; **`REVOKE INSERT`** | **no `USAGE`** (helpers run as owner) |
| `resolution_writer` | `SELECT` only; **`REVOKE INSERT`** | **no `USAGE`** |
| `admin_reader` | `SELECT` | none |
| `bdc_reader` | no base-table SELECT | none |
| Web login | none direct | none — continues `SET ROLE` into existing members |

`REVOKE ALL ON FUNCTION … FROM PUBLIC` for every new helper; grant `EXECUTE` only to the
intended caller role(s).

Functions are owned by the migration owner (same as consolidation SECURITY DEFINER
functions). Each uses `SET search_path = pg_catalog, identity, ops, evidence, ref, …` as
needed (pin schemas; do not leave a writable `search_path`).

#### Authorization asserts (mirror `resolution.assert_consolidation_writer`)

Conceptual helpers (exact names deferred to migration):

- `identity.assert_identifier_pipeline_writer()` — require
  `session_user` is `bdc_pipeline_writer` or has membership in it; else `42501`.
- `identity.assert_identifier_resolution_writer()` — require
  `session_user` is `resolution_writer` or has membership in it (same predicate style as
  `resolution.assert_consolidation_writer` in `0060`).

Always key off **`session_user`**, not `current_user` after `SET ROLE` inside a DEFINER body.

#### Human `ops.run` helper (SECURITY DEFINER)

Conceptual: `identity.begin_legal_entity_identifier_run(p_parameters jsonb)` — same shape as
`resolution.begin_consolidation_run` in `0060_legal_entity_consolidation.sql`:

- `PERFORM identity.assert_identifier_resolution_writer()`.
- Inserts `ops.run` (dedicated `run_kind` / `code_version` for identifier human review) and a
  matching `ops.run_outcome`, returns the new `run_id`.
- Human verify and withdraw helpers **create and associate** this run themselves (call
  `begin_*` internally); they do not accept a caller-supplied human `run_id`. Every human
  assertion is thereby tied to an attributable run minted on that path.

`GRANT EXECUTE … TO resolution_writer` only. `REVOKE ALL … FROM PUBLIC`.

Pipeline UNVERIFIED writes continue to use the caller’s existing pipeline `ops.run` id
(parameter), not this human-review helper — same convention as other pipeline loaders.

#### Pipeline UNVERIFIED helper (SECURITY DEFINER)

Conceptual: `identity.record_unverified_legal_entity_identifier(...)`.

- `PERFORM identity.assert_identifier_pipeline_writer()`.
- Forces `actor_kind = SYSTEM_RULE`, `verification_state = UNVERIFIED`.
- Forces `rule_version_id` from `identity.legal_entity_identifier.pipeline_unverified`.
- Requires non-null `evidence_id`; rejects citation-only and any caller-supplied VERIFIED /
  HUMAN_REVIEW / arbitrary `decided_by` purporting to be a human verifier.
- Sets `decided_by` to a system label (for example `pipeline:legal_entity_identifier`),
  `decided_at = now()`, and records `run_id` from the caller’s pipeline run parameter.
- When a current tip already exists for the same subject, the insert **must** set
  `supersedes_id` to that tip and a non-empty `supersede_reason` (second roots are rejected
  by `single_chain`). Accept `p_expected_current_id` and reject with a stale-head error when
  it does not match the live tip (same pattern as consolidation `p_expected_current_id` in
  `0060`).
- Performs the INSERT as the function owner (so sequence `USAGE` for the invoker is
  unnecessary). Never UPDATE or DELETE prior rows.

`GRANT EXECUTE … TO bdc_pipeline_writer` only.

#### Human VERIFIED / withdrawal helper (SECURITY DEFINER)

Conceptual: `identity.verify_legal_entity_identifier(...)` and/or
`identity.withdraw_legal_entity_identifier(...)` (may be one function with an action
parameter if clearer in DDL).

- `PERFORM identity.assert_identifier_resolution_writer()`.
- Creates and associates `run_id` via `identity.begin_legal_entity_identifier_run(...)`
  (or equivalent); does not accept a caller-supplied human `run_id`.
- Forces `rule_version_id` from `identity.legal_entity_identifier.human_review`.
- Accepts `p_expected_current_id` (nullable when no tip exists yet for a first VERIFIED root)
  and, when superseding, sets `supersedes_id` to the current tip for the **same subject**;
  rejects when `p_expected_current_id` does not match the live tip (stale head), matching
  consolidation propose / reverse / approve in `0060`.
- **VERIFIED path:** forces `actor_kind = HUMAN_REVIEW`, `verification_state = VERIFIED`,
  non-empty `decided_by`, and **evidence_id or a complete citation** (all-or-none citation
  fields: `https` URL + non-empty title + non-empty excerpt, as in
  `resolution.legal_entity_consolidation_decision` CHECKs in `0060` and ADR 0017). When an
  UNVERIFIED tip already exists for the subject, VERIFIED **must** supersede it (append-only;
  no in-place upgrade).
- **Withdrawal path:** supersedes the current tip for the same subject; forces
  `actor_kind = HUMAN_REVIEW`; sets `verification_state = UNVERIFIED` (does not elevate to
  VERIFIED); requires non-empty `decided_by`, non-empty `supersede_reason`, and **the same
  evidence_id or complete-citation requirement** as every other assertion (caller-supplied
  evidence/citation, or explicitly copied from the superseded tip — never blank). Prior tip
  remains unchanged in history.
- Callers cannot pass `SYSTEM_RULE` or forge pipeline state through this helper.

`GRANT EXECUTE … TO resolution_writer` only (web Admin reaches it via
`SET ROLE resolution_writer` after `bdc_reader_login` membership, same operational pattern
as consolidation).

#### Table CHECKs (defense in depth)

Still add CHECKs such as: `VERIFIED ⇒ actor_kind = HUMAN_REVIEW`;
`SYSTEM_RULE ⇒ verification_state = UNVERIFIED AND evidence_id IS NOT NULL`;
evidence-or-citation. CHECKs alone are insufficient without the helper-only INSERT revoke.

### Matching and consolidation safety

**Path for identifier-aware matching (when a future rule exists):**

1. `obs.borrower_name_observation` (or current tip),
2. `resolution.current_entity_resolution` → `legal_entity_id` when MATCHED,
3. `identity.legal_entity`,
4. `identity.current_legal_entity_identifier` filtered to `relationship_role = OWN` and
   `verification_state = VERIFIED`.

Until an explicit versioned resolution rule is Accepted, identifiers are **storage and
reporting only** and must not create or alter `resolution.entity_resolution_decision`.

**Consolidation:** identifier helpers never insert
`resolution.legal_entity_consolidation_decision`. Identical OWN identifiers on two UUIDs are
review signals only; merge remains ADR 0017 human approval via `resolution_writer`.

### `resolution.match_candidate` integration

- Identifier comparisons may populate `resolution.match_candidate` /
  `resolution.match_candidate_comparison` with `ref.comparison_outcome`
  (`AGREE` / `DISAGREE` / `UNKNOWN`) (`0002_vocabularies.sql`, `0007_identity_resolution.sql`).
- Use a dedicated `attribute_code` such as `EXTERNAL_IDENTIFIER` (optionally scheme-qualified
  in rationale/evidence, not as a free-form explosion of codes without a ref list).
- A candidate with `AGREE` on `EXTERNAL_IDENTIFIER` is **not** authorization to MATCHED-merge
  entities or to consolidate UUIDs. MATCHED still requires an explicit entity-resolution rule
  and actor; consolidation still requires ADR 0017 helpers.
- Ambiguous OWN tips (multiple current VERIFIED OWN values for one scheme) ⇒ comparison
  outcome `UNKNOWN` or no MATCHED path (fail closed).

### Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Overload `legal_entity_alias` | Names ≠ typed identifiers |
| Coverage reporting only | Cannot store provenance |
| Store borrower CIK on `registry.registrant` | Violates G-09 |
| `multi` on the fine-grained subject | Allows two root tips for the same subject (`0001`); ambiguous current view |
| `single_chain` on `(legal_entity_id, scheme, relationship_role)` only | Would force a single tip per role and silently block concurrent distinct raw values |
| Direct `INSERT` grants + application checks | Pipeline could forge VERIFIED / HUMAN_REVIEW; fails least privilege |
| Prescribe CIK/LEI normalize algorithms in this ADR | Unsupported by current `norm.*` / G-03 |
| MVP `FILER` role on this table | Duplicates `registry.registrant` without a concrete need |

### Security and migration implications

- Forward-only SQL migration after acceptance; checksummed via `ops.schema_migration`
  (`scripts/db/migrate.mjs`, ADR 0009).
- Migration creates table, ref seeds, rule_version seeds, supersession, current view,
  assert helpers, SECURITY DEFINER write helpers (including human `begin_*_run`), REVOKE
  INSERT from writers, GRANT SELECT / EXECUTE as above.
- Migration **must** end with `SELECT ops.apply_append_only_to_all();` so
  `identity.legal_entity_identifier` receives the repository append-only triggers
  (`ops.forbid_mutation`), same convention as `0060_legal_entity_consolidation.sql` and
  other schema migrations.
- Hosted apply is a **separate explicit operation** (privileged session/direct URL, not
  `bdc_reader_login`), then verification (see Rollout).
- Does not grant pipeline authority to consolidate entities or to write VERIFIED identifiers.

### Testing requirements (when implementing)

- SQL: scheme FK; role CHECK (no FILER in v1); evidence-or-citation CHECK (including
  withdrawal rows); `single_chain` rejects second root for same subject; superseding
  verify/withdraw/pipeline-correct require matching `p_expected_current_id`; stale-head
  rejected; two different `raw_value` OWN tips can both be current; current view;
  `bdc_pipeline_writer` direct INSERT fails; pipeline EXECUTE of unverified helper
  succeeds only as UNVERIFIED; resolution_writer EXECUTE verifies and withdraws;
  withdrawal without evidence/citation fails; pipeline EXECUTE of verify helper fails;
  search_path pinned on DEFINER functions; append-only UPDATE/DELETE forbidden after
  `ops.apply_append_only_to_all()`.
- **Ambiguity detection:** explicit SQL/test that, given two **current** tips with
  `relationship_role = OWN`, `verification_state = VERIFIED`, the same
  `(legal_entity_id, scheme)`, and **different** `raw_value`s, a detector query
  (`COUNT(*) > 1` over `identity.current_legal_entity_identifier` grouped by
  `legal_entity_id, scheme`) reports ambiguity; matching must treat that case as fail-closed
  (`UNKNOWN` / no MATCHED), never pick a winner.
- Resolution safety: identifier helpers do not write consolidation or entity-resolution
  rows.
- Fixtures remain synthetic (G-02).

### Rollout stages (future operations only — not authorized by drafting this ADR)

1. **Design acceptance** of this ADR (status Accepted; schema not yet applied).
2. **Authorized read-only Hosted inventory** (separate approval): filer CIK counts; confirm
   no borrower external-ID table; denominators labeled (entities vs observations vs filers).
   No writes. Coverage remains UNKNOWN until this runs.
3. **Local schema migration + SQL/unit tests** after an authorized implementation pass.
4. **Hosted migrate (operational):**
   - Privileged connection, port ≠ transaction pooler 6543.
   - `npm run db:migrate:hosted` (or equivalent) applying the new migration(s) only when
     pending.
   - Verify `ops.schema_migration` checksums / new filename present.
   - Confirm INSERT revoked from `bdc_pipeline_writer` / `resolution_writer` on the table;
     EXECUTE grants on helpers only as designed; `admin_reader` SELECT; `bdc_reader` lacks
     base-table SELECT.
   - Confirm `bdc_reader_login` memberships unchanged except as intentionally documented
     (still needs `resolution_writer` membership for Admin human verify path, same as
     consolidation).
   - Smoke: table empty; current view empty; direct INSERT as pipeline fails; optional
     ROLLBACK-only helper probes with synthetic ids if approved — no real borrower asserts
     in smoke without a separate decision.
5. **Read-only coverage reporting** over the new table (initially empty) plus separate filer
   stats.
6. **Scoped UNVERIFIED ingestion / human VERIFIED assertions** only after helpers are live;
   no universe-wide MATCHED-on-identifier.

## Consequences

- Borrowers can accumulate typed external IDs without changing the canonical UUID.
- Distinct raw strings remain distinct subjects; matching fails closed when multiple
  VERIFIED OWN tips exist for one scheme.
- Filer CIK remains on `registry.registrant` for MVP; no FILER role duplication.
- Normalization waits on documented, versioned rules.
- VERIFIED writes are attributable and cannot be forged by the pipeline role.
- Hosted borrower CIK/LEI coverage remains **UNKNOWN** until stage 2.
- Review and storage cost increase; accepted for integrity.

## Open questions

- **OPEN QUESTION:** Actual Hosted counts (legal entities, MATCHED observations, accidental
  CIK-like alias text, any filer LEI storage outside registrant attributes).
- **OPEN QUESTION:** Whether a future FILER role is warranted for “borrower is itself an SEC
  registrant” distinct from the holding BDC’s CIK.
- **OPEN QUESTION:** Exact `attribute_code` string(s) for `match_candidate_comparison` when
  the first identifier-aware resolution rule is designed.
- **OPEN QUESTION:** Whether pipeline and human helpers live in schema `identity` or
  `resolution` (consolidation helpers are under `resolution`; this ADR prefers `identity`
  for subject-table locality — confirm at migration authoring).
- **FUTURE / NOT MVP:** Scheme-specific `normalized_value` rules; MATCHED-on-VERIFIED-OWN
  identifier rule; GLEIF feeds; parent-CIK graphs into `identity.economic_group`; instrument
  CUSIP/ISIN tables; FILER role on this relation.
