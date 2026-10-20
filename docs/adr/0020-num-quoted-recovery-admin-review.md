# 0020. Future Admin review of NUM quoted-recovery validation failures

## Status

Accepted (policy for a **future operational capability**). Nothing described here is
implemented. This ADR does not require building an Admin page, schema, or loader path
now.

## Context

ADR 0019 decides how future NUM loads recover syntactically valid quoted extra-tab rows
(`QUOTED_RECOVERY`, sidecar `raw.num_quoted_recovery`) and when those rows may project
(D4, D6, and existing NUM validations). Rows that fail those gates stay quarantined
(`FIELD_COUNT_MISMATCH` or `FOOTLEN_MISMATCH`). ADR 0019 does not define a human review
path.

Automated validation must remain the first gate (G-01, G-07). Some recovered rows may
later need an authorized Admin to inspect source evidence, record a decision, and either
leave the row quarantined or, after evidence-backed confirmation or correction, send it
back through the **same** validation rules. An Admin click must not become a silent
bypass of D6 or of ADR 0019.

Existing conventions this ADR must follow, not replace:

- Application Admin is `access.current_access` effective role ADMIN, checked with
  server-side `requireAdmin()` (ADR 0014). MEMBER and PRO are denied. Email is not an
  authorization key.
- Decision actors are `SYSTEM_RULE` or `HUMAN_REVIEW` only (G-08, ADR 0010).
- History is append-only; corrections supersede with reason, actor, and time (G-10,
  ADR 0005). The recovery sidecar remains append-only (ADR 0019).
- `ops.audit_event` is the existing append-only operations audit table (`event_kind`,
  `subject_table`, `subject_id`, `actor`, `reason`, `details`, `recorded_at`).
- G-13 states (`MATCHED`, `PROBABLE`, `UNRESOLVED`, `REJECTED`) are identity-resolution
  states, not parse statuses and not substitutes for `OK`, `FIELD_COUNT_MISMATCH`, or
  `QUOTED_RECOVERY`.
- Research-workspace writes today go through `review_writer` helpers, not ad hoc
  application INSERTs (migration 0031). This ADR does not reuse that workspace as the
  NUM recovery queue.

ADR 0016 currency binding stays a separate process. Hosted Run 72 and its 23 stored
exceptions stay unchanged (ADR 0019 D4, D9).

## Decision

### Scope and non-implementation

- This is a **future** Admin review capability for NUM quoted-recovery rows that fail
  automated validation on **future** loads.
- It is **not** a requirement to add an Admin UI, migrations, catalog versions, or
  pipeline code in the current phase.
- It does **not** amend or supersede ADR 0019. D1–D12 and the five 0019 schema
  mechanics remain in force.
- No Admin page, review table, or review API is claimed to exist.

### Workflow (when later implemented)

1. **Automated validation runs first.** Naive split, quote syntax (D11), sidecar
   recovery (D1–D3, D10), D6 `footlen`, and every existing NUM validation run before any
   human action. Rows that pass remain eligible for normal future projection (ADR 0019
   D4).
2. **Failures stay quarantined.** They are not `OK`. They do not become
   `obs.num_fact_observation` because an Admin opened them.
3. **An authorized Admin may later review** a quarantined recovered row: inspect original
   source evidence (`raw_line`, naive `cells`, recovered cells, exception kind and
   detail, filing/iXBRL evidence already stored) and the recovered values; record a
   decision and rationale; request further evidence; or reject the recovery.
4. **Revalidation before projection.** If recovered values are confirmed, or if a later
   approved mechanism stores a correction, **all applicable validation rules run again**
   (D6 and existing NUM checks included) before any projection. Confirmation is not a
   substitute for those checks.
5. **Audit.** Every review decision is append-only and auditable: reviewer identity
   (Admin user id / `HUMAN_REVIEW` actor, never email as the key), timestamp, rationale,
   evidence references, and any correction history. Use `ops.audit_event` and, if a
   dedicated decision table is later added, that table as well. No UPDATE of historical
   review rows.

### Two cases (must not be collapsed)

**A. Data correction or confirmation (this ADR).**  
An Admin resolves a recovery issue using documented evidence (for example: the recovered
11 cells are the intended NUM fields; D6 already passes; or the Admin requests more
evidence / rejects recovery). After confirmation with **unchanged** recovered cells, the
normal validation rules run again. Projection occurs only if those rules pass.

Storing a **replacement** recovered-cell array is **not** authorized here. ADR 0019’s
sidecar is append-only and designed as one recovery per `tabular_row`. Overwriting it
would violate G-10. A second recovered version would need a later explicit schema
decision. Until then, Admins may inspect, confirm, reject, or request evidence only.

**B. Exception to a validation rule (not authorized).**  
An Admin request to **bypass** a rule such as D6 is a different act from confirming
cells. This ADR **does not** grant that power. Default is fail-closed: D6 still blocks
projection after an Admin “approval.” Any D6 (or other validation) exception mechanism
requires a **separate, explicit** policy ADR and documented safeguards. It is not
implied by this workflow.

### Authorization and audit conventions

- Server-side `requireAdmin()` only. `proxy.ts` is not the security boundary (ADR 0014).
- Web clients must not INSERT review decisions except through a future helper granted to
  an appropriate writer role (same pattern as `review_writer` / `resolution_writer`).
  The exact role is unresolved until implementation.
- Bootstrap/operator grant of ADMIN remains `access.record_grant` / operator script, not
  this workflow.
- LLM output is never a source of financial facts or an approval (G-08).

### Preserved data policies

- Failed rows remain quarantined unless an explicitly approved, evidence-backed
  resolution **and** a subsequent passing validation permit further processing.
- Recovery sidecar remains append-only.
- Historical Run 72 and its 23 quarantined exceptions remain unchanged. This review
  path does not retroactively project them.
- Recovery and any future manual review apply to future loads only.
- Currency binding is not triggered by manual review (ADR 0016, ADR 0019 D12).
- Identifier whitespace is not normalized (ADR 0019 D5).

### Future implementation (not this phase)

Minimum work if this capability is later built, all labeled future:

- Append-only review-state and decision-history storage (table names unresolved; must
  not UPDATE `raw.tabular_row` or `raw.num_quoted_recovery`).
- Server-side authorization (`requireAdmin()` plus a writer helper).
- Read-only inspection of source evidence and recovered values.
- Audit trail (`ops.audit_event` at minimum; `event_kind` values unresolved).
- Revalidation job or function that reapplies D6 and existing NUM validations before
  projection.
- A future Admin UI **if** justified; existing `/admin` filing QA does not implement
  this queue.

Do not create those objects under this documentation phase.

## Consequences

- ADR 0019 implementation can proceed without an Admin review UI.
- `FOOTLEN_MISMATCH` and other validation failures remain fail-closed until a later
  phase implements this review path **without** bypassing D6.
- Operators must not treat Admin role alone as a NUM projection license.
- Open policy that still needs a later explicit decision: whether Admins may ever
  store corrected recovered cells, and whether any validation-rule exception (including
  D6) will exist at all.
