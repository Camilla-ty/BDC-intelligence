# Runbook: Hosted read-only inventory for ADR 0018

## Purpose

Establish the **current Hosted database baseline** before implementing external identifiers
for portfolio legal entities (`docs/adr/0018-legal-entity-external-identifiers.md`,
**Accepted**).

This runbook is for a **separately authorized operator**. It defines read-only SQL only.

## Explicit non-claims

- ADR 0018 is **Accepted** as design. Its proposed objects
  (`identity.legal_entity_identifier`, helpers, `ref.legal_entity_identifier_scheme`,
  related `ops.rule_version` seeds) are **not** assumed to exist in Hosted.
- **No query in this runbook has been executed** by the authoring agent. Result values
  below are shapes and interpretation rules only — never fabricated Hosted facts.
- Filer CIK counts are **not** borrower CIK/LEI coverage (G-09).

## Constraints (operator)

1. **Read-only.** No `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / DDL / `NOTIFY` /
   `COPY … FROM` / migration runner / backfill / ingestion.
2. Do **not** use `bdc_reader_login` (or any web App login) as a migrator or for this
   inventory if that role lacks the catalog/table SELECT needed — and **never** elevate
   that login to apply migrations during this step.
3. Prefer session pooler / direct connection semantics consistent with Hosted ops docs;
   do not print credentials or connection strings in tickets, logs, or chat.
4. Set a short `statement_timeout` (for example 30s) before heavy counts if the session
   allows it.
5. Stop on any stop condition below; do not “fix around” by writing or guessing.

## Minimum operator privileges

| Need | Why |
| --- | --- |
| `SELECT` on `ops.schema_migration`, `ops.rule_version`, `ops.run` (and related) | Ledger and dependency presence |
| `SELECT` on `identity.legal_entity`, `identity.legal_entity_alias` | Entity / alias baseline |
| `SELECT` on `obs.borrower_name_observation` and current-name views if present | Observation denominators |
| `SELECT` on `resolution.entity_resolution_decision` / `resolution.current_entity_resolution` | Resolution-state mix |
| `SELECT` on `registry.registrant`, `registry.filing_registrant_link`, related current views | Filer CIK and filing links (separate from borrowers) |
| `SELECT` on `evidence.evidence` (existence / count only) | Dependency for future assertions |
| `SELECT` on `pg_catalog` / `information_schema` privilege views | Roles, grants, function EXECUTE |
| Confirm presence of functions `ops.add_supersession`, `ops.check_supersession`, `ops.apply_append_only_to_all` | Migration prerequisites |

A SELECT-capable inventory role is sufficient (catalog + listed table/view SELECT only).  
Write, DDL, and migration privileges are **not** required and must not be used.  
**Do not** use the web reader login as the migration principal for later stages.

---

## Preconditions

1. Separate written authorization to run **read-only** Hosted inventory for ADR 0018.
2. Operator has a Hosted connection that can `SELECT` the objects above (without printing the URL).
3. Local git checkout available to compare migration filenames / checksums against
   `db/migrations/` (checksum comparison may be done offline from exported ledger rows).
4. Repository tip includes Accepted ADR 0018; local migrations through at least `0062_*.sql`
   are the **design** baseline for “what the repo expects,” not a claim about Hosted.

### Target-database identity checks (run first)

```sql
-- R0: session identity (no secrets)
SELECT
  current_database() AS database_name,
  current_user       AS current_user_name,
  session_user       AS session_user_name,
  inet_server_addr() IS NOT NULL AS has_server_addr,
  current_setting('transaction_read_only', true) AS txn_read_only_setting;
```

**Expected shape:** one row; `database_name` matches the authorized BDC Hosted database
(operator-confirmed name — do not invent it here).

**Stop if:** database name is not the authorized target; `session_user` is an App-only
login you were told not to use for inventory; any statement fails with permission denied
before R1 completes (escalate privileges for read-only inventory, do not switch to write).

Optional hardening (if permitted in session):

```sql
SET statement_timeout = '30s';
-- Prefer read-only transaction if the role allows:
-- BEGIN READ ONLY;
```

---

## A. Migration ledger and checksums

### A1. Ledger inventory

```sql
SELECT filename, sha256, applied_at
FROM ops.schema_migration
ORDER BY filename;
```

**Expected shape:** zero or more rows; filenames matching `^[0-9]{4}_[a-z0-9_]+\.sql$`;
64-char hex `sha256`.

**Interpretation:**

- Record `max(filename)` / last applied migration label.
- Compare each `(filename, sha256)` to the repository file digest produced by the same
  algorithm as `scripts/db/migrate.mjs` (offline). Mismatch ⇒ **STOP** (do not plan ADR
  0018 DDL on a divergent ledger).
- Note whether `0060`–`0062` (consolidation) appear. Absence is a Hosted fact to report,
  not something to invent or “fix” in this inventory.

### A2. Bounded ledger summary

```sql
SELECT
  count(*)::bigint AS migration_row_count,
  min(filename)    AS first_filename,
  max(filename)    AS last_filename
FROM ops.schema_migration;
```

**Expected shape:** one row of aggregates.

---

## B. Confirm ADR 0018 objects are absent (fail closed on premature claims)

```sql
SELECT
  to_regclass('identity.legal_entity_identifier') IS NOT NULL AS has_legal_entity_identifier,
  to_regclass('ref.legal_entity_identifier_scheme') IS NOT NULL AS has_identifier_scheme_ref,
  to_regprocedure('identity.record_unverified_legal_entity_identifier') IS NOT NULL
    AS has_pipeline_identifier_helper_probe;
```

**Expected shape:** one row of booleans.

**Interpretation:**

- If all false ⇒ consistent with “Accepted design, not yet implemented” → borrower typed
  CIK/LEI coverage remains **UNKNOWN** / **N/A** (no typed store).
- If any true ⇒ **STOP** and escalate: Hosted already has partial ADR 0018 objects outside
  this runbook’s assumptions; do not invent a coverage story.

(Adjust the `to_regprocedure` probe if the final helper signature differs; absence of the
name is the intended signal.)

---

## C. Legal entities and aliases

### Denominators (definitions)

| Denominator ID | Definition |
| --- | --- |
| **D-LE** | `count(*)` from `identity.legal_entity` |
| **D-ALIAS-ROWS** | `count(*)` from `identity.legal_entity_alias` (history included) |
| **D-ALIAS-ENTITIES** | `count(DISTINCT legal_entity_id)` from `identity.legal_entity_alias` |

Do not treat alias rows as entities. Do not treat entities without aliases as zero exposure.

### C1. Entity and alias counts

```sql
SELECT
  (SELECT count(*)::bigint FROM identity.legal_entity) AS legal_entity_count,
  (SELECT count(*)::bigint FROM identity.legal_entity_alias) AS alias_row_count,
  (SELECT count(DISTINCT legal_entity_id)::bigint FROM identity.legal_entity_alias)
    AS entities_with_any_alias;
```

**Expected shape:** one row of three non-negative integers.

### C2. Alias verification mix (bounded aggregate)

```sql
SELECT verification_state, count(*)::bigint AS alias_rows
FROM identity.legal_entity_alias
GROUP BY verification_state
ORDER BY verification_state;
```

**Expected shape:** zero or more rows keyed by `UNVERIFIED` / `VERIFIED`.

### C3. Heuristic alias text probe (not coverage)

CIK-like **text in aliases is not a typed borrower CIK**. Report as exploratory only.

```sql
SELECT count(*)::bigint AS alias_rows_digit_only_1_to_10
FROM identity.legal_entity_alias
WHERE btrim(alias_text) ~ '^[0-9]{1,10}$';
```

**Expected shape:** one integer.  
**Label result:** `HEURISTIC_ONLY` — does **not** authorize OWN CIK assertions.

Optional sample (hard cap):

```sql
SELECT id, legal_entity_id, left(alias_text, 64) AS alias_preview, verification_state
FROM identity.legal_entity_alias
WHERE btrim(alias_text) ~ '^[0-9]{1,10}$'
ORDER BY id
LIMIT 25;
```

---

## D. Borrower-name observations and resolution states

### Denominators

| Denominator ID | Definition |
| --- | --- |
| **D-BNO** | `count(*)` from `obs.borrower_name_observation` (all history) |
| **D-BNO-CURRENT** | `count(*)` from `obs.current_borrower_name_observation` if the view exists; else mark UNKNOWN and use tip logic only after confirming the view |
| **D-ER-CURRENT** | `count(*)` from `resolution.current_entity_resolution` |
| **D-ER-MATCHED-ENTITIES** | `count(DISTINCT legal_entity_id)` from current tips where `state = 'MATCHED'` and `legal_entity_id IS NOT NULL` |

Never add observation counts to entity counts. Never treat missing resolution as MATCHED.

### D1. Observation counts

```sql
SELECT count(*)::bigint AS borrower_name_observation_rows
FROM obs.borrower_name_observation;
```

```sql
-- Only if to_regclass('obs.current_borrower_name_observation') is not null:
SELECT count(*)::bigint AS current_borrower_name_observation_rows
FROM obs.current_borrower_name_observation;
```

### D2. Current resolution state mix

```sql
SELECT state, count(*)::bigint AS current_decision_rows
FROM resolution.current_entity_resolution
GROUP BY state
ORDER BY state;
```

**Expected shape:** rows for subset of `MATCHED`, `PROBABLE`, `UNRESOLVED`, `REJECTED`.

### D3. Distinct MATCHED legal entities (entity denominator for “resolved borrowers”)

```sql
SELECT count(DISTINCT legal_entity_id)::bigint AS distinct_matched_legal_entities
FROM resolution.current_entity_resolution
WHERE state = 'MATCHED'
  AND legal_entity_id IS NOT NULL;
```

**Interpretation:** this is **not** CIK coverage. It is the count of entities currently
linked by MATCHED name resolution.

---

## E. Registrant (filer) CIK and filing relationships — separate from borrowers

### Denominators

| Denominator ID | Definition |
| --- | --- |
| **D-REG** | `count(*)` from `registry.registrant` |
| **D-REG-CIK** | same as D-REG when every registrant has a CIK (schema requires `cik`) |
| **D-FILING-LINK-ROWS** | `count(*)` from `registry.filing_registrant_link` |
| **D-FILING-WITH-CURRENT-REG** | distinct filings with a current registrant link (use project current view if present) |

**Rule:** publish filer stats in a section titled **Filer / registrant only**. Never merge
into borrower CIK/LEI coverage.

### E1. Registrant CIK inventory

```sql
SELECT
  count(*)::bigint AS registrant_count,
  count(DISTINCT cik)::bigint AS distinct_cik_count,
  min(cik) AS min_cik,
  max(cik) AS max_cik
FROM registry.registrant;
```

**Expected shape:** one aggregate row.  
`registrant_count` should equal `distinct_cik_count` given `UNIQUE (cik)`; if not, **STOP**
and escalate (data integrity).

### E2. Filing–registrant link volume

```sql
SELECT count(*)::bigint AS filing_registrant_link_rows
FROM registry.filing_registrant_link;
```

```sql
-- Prefer current tip view when present:
SELECT to_regclass('registry.current_filing_registrant') IS NOT NULL AS has_current_filing_registrant;
```

```sql
-- If has_current_filing_registrant:
SELECT count(*)::bigint AS current_filing_registrant_rows
FROM registry.current_filing_registrant;
```

```sql
-- If has_current_filing_registrant (D-FILING-WITH-CURRENT-REG):
SELECT count(DISTINCT filing_id)::bigint AS distinct_filings_with_current_registrant
FROM registry.current_filing_registrant;
```

### E3. Registrant attribute codes (LEI hunt on filer side only)

Repository seeds for `ref.registrant_attribute` are name/file/ticker/exchange — **no LEI**
in `db/migrations/0002_vocabularies.sql`. Still verify Hosted:

```sql
SELECT code, description
FROM ref.registrant_attribute
ORDER BY code;
```

```sql
SELECT attribute_code, count(*)::bigint AS observation_rows
FROM registry.registrant_attribute_observation
GROUP BY attribute_code
ORDER BY attribute_code;
```

**Interpretation:** any unexpected code resembling LEI/CIK-as-attribute is a Hosted fact to
record under **filer attributes**, not borrower identifiers.

---

## F. Search for existing LEI / typed borrower external-identifier storage

### F1. Catalog name search (bounded)

```sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN (
    'identity', 'resolution', 'obs', 'registry', 'evidence', 'ref', 'ops', 'derived', 'validation'
  )
  AND (
    c.relname ILIKE '%lei%'
    OR c.relname ILIKE '%legal_entity_identifier%'
    OR c.relname ILIKE '%external_id%'
  )
ORDER BY 1, 2
LIMIT 100;
```

**Expected shape:** zero or more catalog rows (often empty).

### F2. Column-name search (bounded)

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN (
    'identity', 'resolution', 'obs', 'registry', 'evidence', 'ref', 'derived'
  )
  AND (
    column_name ILIKE '%lei%'
    OR column_name ILIKE 'cik'
    OR column_name = 'raw_value' AND table_name ILIKE '%identifier%'
  )
ORDER BY 1, 2, 3
LIMIT 200;
```

**Interpretation:**

- `registry.registrant.cik` is **expected** (filer).
- Absence of borrower LEI/CIK columns on `identity.legal_entity` is **expected**
  (`0007_identity_resolution.sql` comment: no CIK column).
- Do **not** count filer CIK as borrower coverage.

### F3. Borrower typed coverage gate

| Condition | Coverage reporting |
| --- | --- |
| No typed borrower identifier table/columns | Borrower CIK/LEI coverage = **UNKNOWN (no typed store)** — do not compute a percentage |
| Typed store exists unexpectedly | **STOP**; inventory partial objects before any ADR 0018 migration design tweak |

---

## G. Roles, memberships, and privileges

### G1. Role existence

```sql
SELECT r.rolname, r.rolcanlogin, r.rolsuper
FROM pg_catalog.pg_roles r
WHERE r.rolname IN (
    'bdc_pipeline_writer',
    'bdc_reader',
    'bdc_reader_login',
    'resolution_writer',
    'admin_reader',
    'access_reader',
    'review_writer'
  )
ORDER BY r.rolname;
```

**Expected shape:** subset of roles; missing `resolution_writer` means consolidation
migrations may be unapplied (cross-check section A).

### G2. Memberships (who inherits what)

```sql
SELECT
  r.rolname AS member_role,
  m.rolname AS inherits_role
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles r ON r.oid = am.member
JOIN pg_catalog.pg_roles m ON m.oid = am.roleid
WHERE r.rolname IN ('bdc_reader_login', 'bdc_pipeline_writer', 'bdc_reader')
   OR m.rolname IN ('resolution_writer', 'admin_reader', 'bdc_reader', 'bdc_pipeline_writer')
ORDER BY 1, 2
LIMIT 200;
```

**Interpretation for later ADR 0018 human path:** Admin verify helpers will need
`resolution_writer` membership on the login that `SET ROLE`s — same operational pattern as
ADR 0017. Inventory only; do not `GRANT` here.

### G3. Table privileges on identity / resolution / registry (sample)

```sql
SELECT
  grantee,
  table_schema,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema IN ('identity', 'resolution', 'registry', 'ops', 'evidence')
  AND table_name IN (
    'legal_entity',
    'legal_entity_alias',
    'entity_resolution_decision',
    'legal_entity_consolidation_decision',
    'registrant',
    'schema_migration',
    'rule_version',
    'run',
    'evidence'
  )
  AND grantee IN (
    'bdc_pipeline_writer',
    'bdc_reader',
    'resolution_writer',
    'admin_reader',
    'PUBLIC'
  )
GROUP BY grantee, table_schema, table_name
ORDER BY 2, 3, 1;
```

**Expected shape:** grant matrix rows.  
**Note for future ADR 0018 DDL:** pipeline must **not** retain broad `INSERT` on the new
identifier table; this inventory only records today’s grants on existing tables.

### G4. Sequence privileges (consolidation comparison)

```sql
SELECT
  grantee,
  object_schema,
  object_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.usage_privileges
WHERE (
    (object_schema IN ('resolution', 'identity') AND object_name ILIKE '%consolidation%id_seq%')
    OR (object_schema = 'ops' AND object_name IN ('run_id_seq', 'run_outcome_id_seq'))
  )
GROUP BY grantee, object_schema, object_name
ORDER BY 2, 3, 1
LIMIT 100;
```

(If `usage_privileges` is empty in this Hosted catalog view, fall back to
`aclexplode(pg_class.relacl)` on sequences — still read-only.)

### G5. Consolidation helper EXECUTE (dependency pattern for ADR 0018)

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'resolution'
  AND p.proname IN (
    'assert_consolidation_writer',
    'begin_consolidation_run',
    'propose_legal_entity_consolidation',
    'approve_legal_entity_consolidation',
    'reverse_legal_entity_consolidation',
    'canonical_legal_entity'
  )
ORDER BY 2, 3;
```

**Expected shape:** zero or more functions. Absence ⇒ consolidation not on Hosted yet
(report; do not invent).

---

## H. Required dependencies for a future ADR 0018 migration

### H1. Supersession and append-only helpers

```sql
SELECT
  to_regprocedure('ops.add_supersession(regclass,text,text)') IS NOT NULL AS has_add_supersession,
  to_regprocedure('ops.check_supersession()') IS NOT NULL AS has_check_supersession,
  to_regprocedure('ops.apply_append_only_to_all()') IS NOT NULL AS has_apply_append_only;
```

**Stop if:** any required function is missing — foundation migrations incomplete.

### H2. Evidence / rule_version / run

Presence probe only (catalog lookup; does not reference the tables as relations):

```sql
SELECT
  to_regclass('evidence.evidence') IS NOT NULL AS has_evidence,
  to_regclass('ops.rule_version') IS NOT NULL AS has_rule_version,
  to_regclass('ops.run') IS NOT NULL AS has_run,
  to_regclass('ops.run_outcome') IS NOT NULL AS has_run_outcome;
```

**Expected shape:** one row of booleans. Report each `false` as **absent**.

**Gate for counts:** execute the two statements below **only if** both `has_rule_version` and
`has_run` are `true`. If either is `false`, **skip** both count statements and record
`ops.rule_version` and/or `ops.run` as absent. Do not put `to_regclass` in the same
`SELECT` as a `FROM ops.rule_version` / `FROM ops.run` reference — a missing table is not
protected by a sibling expression in one query.

```sql
SELECT count(*)::bigint AS rule_version_rows
FROM ops.rule_version;
```

```sql
SELECT count(*)::bigint AS run_rows
FROM ops.run;
```

**Expected shape (when both tables exist):** one integer per statement.  
Do not dump `ops.run` contents.

### H3. Actor / resolution enums (sanity)

```sql
SELECT enumlabel
FROM pg_catalog.pg_enum e
JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'ref' AND t.typname = 'actor_kind'
ORDER BY enumsortorder;
```

```sql
SELECT enumlabel
FROM pg_catalog.pg_enum e
JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'ref' AND t.typname = 'resolution_state'
ORDER BY enumsortorder;
```

**Expected shape:** `SYSTEM_RULE` / `HUMAN_REVIEW`; resolution states including MATCHED,
PROBABLE, UNRESOLVED, REJECTED.

---

## I. Coverage reporting rules (after queries)

### Always separate

1. **Filer CIK:** D-REG / distinct CIK from `registry.registrant` (section E).
2. **MATCHED legal entities:** D-ER-MATCHED-ENTITIES (section D) — name resolution only.
3. **Legal entities:** D-LE (section C).
4. **Borrower typed CIK/LEI:** only if section B/F finds a typed store; otherwise
   **UNKNOWN (no typed store)** — never 0%, never “same as filer count.”

### Forbidden conclusions

- Inferring borrower CIK from holder BDC CIK on the same filing (G-09).
- Treating digit-only aliases as verified OWN CIK.
- Double-counting by summing D-BNO + D-LE + D-REG into one “coverage” number.

---

## Stop conditions

| Condition | Action |
| --- | --- |
| Wrong `current_database()` | Abort; reconnect to authorized DB |
| Ledger checksum ≠ repo digest for any filename | Abort; escalate schema drift |
| Permission denied on core inventory tables | Escalate read grants; do not use write roles to “get past” it |
| ADR 0018 objects already present unexpectedly | Abort; redesign inventory / migration plan |
| Registrant `count(*)` ≠ `count(DISTINCT cik)` | Abort; integrity review |
| Any accidental write / DDL | Abort; incident per ops practice |
| Pressure to compute borrower CIK% without typed store | Refuse; record UNKNOWN |

---

## Operator report template (fill after execution)

```text
Hosted inventory — ADR 0018 (read-only)
Authorization ticket: ________
Executed at (UTC): ________
Database name: ________
session_user / current_user: ________ / ________
statement_timeout: ________

A. Last schema_migration filename: ________
   Checksums vs repo: MATCH / MISMATCH / NOT COMPARED
   0060–0062 present: yes / no / partial

B. legal_entity_identifier present: yes / no

C. D-LE=__  D-ALIAS-ROWS=__  D-ALIAS-ENTITIES=__
   Heuristic digit aliases (HEURISTIC_ONLY)=__

D. D-BNO=__  D-BNO-CURRENT=__  D-ER-CURRENT=__
   Resolution mix: ________
   D-ER-MATCHED-ENTITIES=__

E. Filer D-REG=__  distinct CIK=__
   filing_registrant_link rows=__
   registrant_attribute codes: ________

F. Extra LEI/identifier relations/columns: none / LIST
   Borrower typed CIK/LEI coverage: UNKNOWN (no typed store) / OTHER:________

G. Roles present: ________
   bdc_reader_login inherits resolution_writer: yes / no / n/a

H. add_supersession / check_supersession / apply_append_only: ________
   evidence / rule_version / run present: ________

Stop conditions hit: none / LIST
Writes performed: none (required)
```

---

## Out of scope (this runbook)

- Implementing `identity.legal_entity_identifier` or helpers
- Hosted `db:migrate:hosted`
- `GRANT resolution_writer TO …`
- Pipeline UNVERIFIED ingestion or human VERIFIED assertions
- Changing ADR 0018 status (remains **Accepted**)

## Execution status

**No SQL in this document has been executed against Hosted or any other database as part of
preparing this runbook.**
