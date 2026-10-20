# 0021. One-time August 2026 NUM quoted-TSV recovery backfill

## Status

Accepted (policy only). Acceptance authorizes local implementation and local rehearsal
only. It does not authorize Hosted data changes; Hosted execution requires a separate,
later approval.

## Context

ADR 0019 defines quoted-TSV recovery for future NUM loads: naive cells stay on
`raw.tabular_row`, recovered cells go on `raw.num_quoted_recovery`, parse status
`QUOTED_RECOVERY` is not `OK`, and D6 `footlen` plus every existing NUM gate must pass
before projection. D4 and D9 leave Hosted Run 72 unchanged: no rewrite of the 23 stored
`FIELD_COUNT_MISMATCH` rows and no `num:load` replay of that artifact. ADR 0020 is a
future Admin review path; it does not project Run 72 rows and does not bypass D6.

Hosted now has migrations 0063–0066. The August 2026 NUM artifact is already `LOADED` by
`pipeline.num_load`. Measured state after 0066 on that artifact: 950,069 source rows, 23
`FIELD_COUNT_MISMATCH` rows, 950,046 `obs.num_fact_observation` rows, zero sidecar rows,
zero `QUOTED_RECOVERY` rows, and zero `FOOTLEN_MISMATCH` exceptions. `npm run num:load`
skips any artifact with `LOADED` on any version of `pipeline.num_load`
(`alreadyProcessed` in `pipeline/load/run.mjs`). Bumping that rule version does not
reprocess August 2026.

Those 23 stored rows cannot be recovered in place. `raw.tabular_row` is append-only
(G-10). A sidecar insert requires `parse_status = QUOTED_RECOVERY`. Projection refuses
`FIELD_COUNT_MISMATCH`. A forced full `num:load` would insert a second 950,069-row
table load and duplicate the 950,046 existing facts. `raw.table_load` has no unique
constraint on `(artifact_id, table_code)`, so a second backfill apply would also
duplicate unless the new command has its own skip-on-`LOADED` ledger.

The reviewed reprocessing plan therefore requires a one-time, pinned backfill: new
location rows for the 23 candidates only, using the existing parser and fail-closed
gates. This ADR is that policy. It does not supersede ADR 0016, 0019, or 0020. It
narrows D4/D9 for one named artifact and 23 locked lines only.

## Decision

### Authorization

Acceptance authorizes **local implementation and local rehearsal only**. It does not
authorize:

- changing `alreadyProcessed` or `pipeline.num_load`;
- any Hosted INSERT, UPDATE, DELETE, migration, loader, or bind.

Hosted execution requires a **separate, later approval** after the preflight and
assertions below succeed.

### Scope (one artifact, one NUM load, 23 locked lines)

Exactly one Hosted `raw.artifact` must match all of:

- `sha256` = `0529ab8920f4d5c02d4f9b1ddc933d914065d4a3acf8bed39a49f44b040f657d`
- `source_type_code` = `SEC_BDC_DATASET_ZIP`

Zero matches or more than one match **stops**. `raw.artifact` is unique on
`(source_url, sha256)`, so SHA alone is not sufficient.

That artifact must have **exactly one** existing NUM `raw.table_load` with
`row_count = 950069` and `field_count_mismatch_count = 23`. Preflight records that
`table_load_id` and pins it. Do not invent the id in this ADR.

Process only the 23 existing `FIELD_COUNT_MISMATCH` rows that:

- belong to that pinned artifact and pinned source `table_load_id`;
- match the structure-only lock in
  `pipeline/test/num-aug-2026-08-exceptions.test.mjs`.

The lock is:

| Line | `raw_line` SHA-256 |
| --- | --- |
| 1790 | `d50a435159ac66fbd1b99c6dd7ed6e94986b73149c62cc1c69c88e3c87dbad9f` |
| 18371 | `8bbfca0c8b78f54570afa2ac4e8a4af961c1709bb1e546aa7d0b3cee31113a2f` |
| 273144 | `a03cdf1fd6fb058bdd75993f130ef1d60382653c9a4a969bab11d074779bf45b` |
| 273311 | `9378a61feba91847b2c98898d530e4d37eed0e8e2483f986649c950efdd4448c` |
| 433063 | `65c364f597a8406899be6f3432be687180e8c2bcb4e90427ac1e0eab3a8a3236` |
| 634367 | `b4e68d22c66e6b38f74a3f4aa7616dfe81f64625a8b56c7f32e35311574b2e25` |
| 638720 | `27b1ca6e3ed13178ce877782bce04c65975655b56091862d5dc12cbb9836fcb4` |
| 639900 | `7d3e9bf84caea73a41a9add890da77f359b3a875bbc04c4193285c1aeb4d998e` |
| 639901 | `4cd89e519246373b36e296a3b2a994b11adf913ca68886228391b2141853b3f9` |
| 640021 | `7af804dbc42b865ec2f8bc33777512cc0d4fe1086aeb6f8a4d8d12e4279c9854` |
| 640022 | `21e7d26aa4efc17de49058b43b0a2eb33ecf79fc77dabba1dd5f8f8de991fa3b` |
| 640154 | `e9e537ac0eb75a8edc40024686e91c7a4c5f3835fb19952b910fb8fa9a75d519` |
| 643855 | `0093b2b44db34213e8124dac77a19b4b759105915511753ebfe0232d8da53187` |
| 647250 | `f053b0b920b66a4b429e42ad1d8997d45b4d73d6bee1207b243acdbeddad1602` |
| 652709 | `f5c1897310f4377404440e7972a79650ea6d3a58247acc31898e7965d5c36950` |
| 793877 | `300e10a52e05e32c4658e7d4f18a25d6b9ff55cd33cabbd86215d7ff369ba57b` |
| 802489 | `d801c302ae06d7420e0d9e1ab20a10d786e271708832e7dd9f4cb40d90dca615` |
| 806821 | `28d6f594af259fe11265043ff5f0efa9f4711fea6386616f88ef0f877ec3c812` |
| 816624 | `fc1ab92c3768f2302b701b66d966a712885bc02b41d99122f6fb10302d147565` |
| 825968 | `74e5314e6d53ac968fb0934d2c077c2fa2bf9018a141537676b8bf0204ae8507` |
| 828926 | `46e710eaef2dee218ea918d67957eafbca44b1285364c15cf0baa187425a2105` |
| 841844 | `4487bb8603a191503640b19ad7acfcda01b95b94859d37deedc4e77f30dcba4a` |
| 949170 | `a3da67bff9895ad04f51f7873662fbf1aae6e570f5713164dcbf5fa7bfeec7ce` |

Any other artifact, table, line, or SHA is out of scope.

### Hard stops

The command **stops** and inserts nothing if any of the following is true:

- not exactly one pinned artifact, or not exactly one NUM `table_load` on it;
- the pinned source `table_load` id passed to the command is not that load, or its
  `row_count`, `field_count_mismatch_count`, header, or member differs from the pin;
- the pinned source `table_load` was written by `parser.sec_num_tsv` v3 (see
  *Parser-version precondition*);
- locked line missing from the pinned source `table_load`;
- locked row `parse_status` is not `FIELD_COUNT_MISMATCH`, or the source load's
  `FIELD_COUNT_MISMATCH` rows are not exactly the locked rows;
- `(line_number, raw_line_sha256)` differs from the lock;
- `recoverQuotedNumCells` returns null or a width other than 11;
- the D6 result of a locked line differs from the locked classification below;
- an optional ZIP byte-check is performed and the ZIP file SHA-256 differs from the
  pin, or the member line bytes disagree with the stored `raw_line` (that
  disagreement is a **hard stop**, not a fallback).

These checks run read-only **before any write**: a stop here inserts no run row, no
catalog row, and no data. The data transaction repeats the artifact, source-load,
parser-version, and lock checks before its first insert; a stop there rolls back.

Do not recover from the ZIP as a substitute for a mismatched stored line. Do not
continue past a failed line.

### Parser-version precondition

`raw.table_load` is unique on `(artifact_id, artifact_member_id,
parser_rule_version_id)`. The new recovery load uses `parser.sec_num_tsv` v3 on the
same artifact and member as the pinned source load. The pinned source load must
therefore have been written by a **different** parser version (Run 72 predates v3).
If the source load's parser version is v3, the command stops before any data insert;
it never relies on the unique violation, and it never writes the recovery load under
another parser version.

### Command and catalog (not `num:load`)

Pinned names:

| Item | Value |
| --- | --- |
| `rule_code` | `pipeline.num_quoted_recovery_backfill` |
| `rule_kind` | `EXTRACTION` |
| `ops.run.run_kind` | `NUM_QUOTED_RECOVERY_BACKFILL` |
| Parser | existing `parser.sec_num_tsv` v3 |
| Projection | existing `obs.projection.num` v3 |

Command: `npm run num:recover-quoted -- --source-table-load-id ID [--zip PATH] [--db NAME]`
(`pipeline/recover-num-quoted.mjs`, core in
`pipeline/load/num-quoted-recovery-backfill.mjs`). `--source-table-load-id` is the id
recorded by the read-only preflight and is required. `--zip` is the optional byte-check.

Catalog registration happens at run time, not in a migration. The rule is in
`pipeline/load/rules.mjs` as `pipeline.num_quoted_recovery_backfill` v1, marked
ensure-only: the command registers it, `parser.sec_num_tsv` v3, and
`obs.projection.num` v3 only through `ensureAndLinkRuleForRun`, and links all three
to its run. `registerRules` skips ensure-only rules, so no other loader registers it.

Rule-version provenance of the rows written:

| Row | Rule version |
| --- | --- |
| new `raw.table_load`, `raw.num_quoted_recovery` | `parser.sec_num_tsv` v3 |
| `ops.projection_exception`, `obs.num_fact_observation` | `obs.projection.num` v3 |
| `ops.artifact_processing` (`LOADED`) | `pipeline.num_quoted_recovery_backfill` v1 |

The projection SQL for those rows is a copy of `obs.projection.num` v3 kept in the
backfill rule's files, so the v3 parser and projection definitions stay unchanged. A
synthetic integration test compares its output with a standard `num:load` of the
same lines.

- Do **not** change `alreadyProcessed` for `pipeline.num_load`, that rule’s versions,
  or skip-on-`LOADED` for ordinary `num:load`, including this ZIP.
- Do **not** add a `--force` flag to `num:load`.
- Quoted splitting stays in `pipeline/parse/num-quoted-tsv.mjs`. Do not re-implement it
  in SQL (ADR 0019).
- Use the stored `raw_line` of each locked FCM row as the recovery input. A ZIP read
  is only an optional byte-check and never replaces stored text.

### Skip-on-LOADED for the dedicated rule

The backfill command must skip this artifact when `ops.artifact_processing` already
has `outcome = 'LOADED'` for `pipeline.num_quoted_recovery_backfill` on **any**
version of that `rule_code`. A version bump must **not** authorize a second
application. This is the same rule-code skip shape as `alreadyProcessed`, applied
only to the dedicated code. It must not alter `pipeline.num_load` skip behavior.

The command checks this read-only before any other work, and again inside the data
transaction after taking a transaction-level advisory lock, so two concurrent
commands cannot both apply. A skip records an `ops.run` row and a `SUCCEEDED`
`ops.run_outcome` with `skipped = 1` and writes no data. The read-only skip registers
no rule. A skip inside the transaction happens after the run's catalog rows have
committed (see One transaction), so that run keeps its links to the already-registered
rule versions; the run's outcome counts record `skipped_in_transaction = 1`.

A successful rerun is therefore a **no-op**.

### One transaction

All backfill **data** inserts and the successful `ops.artifact_processing` row
(`LOADED`, this `rule_code`) **commit in one transaction**:

- new `raw.table_load` on the pinned artifact/member;
- 23 new `raw.tabular_row` rows;
- 23 `raw.num_quoted_recovery` sidecars (deferred trigger requires the same
  transaction);
- evidence;
- `FOOTLEN_MISMATCH` (and any `ORPHAN_ADSH`) exceptions for the **new** rows only;
- at most 13 new `obs.num_fact_observation` rows on **new** `tabular_row_id`s.

`ops.run` / `ops.run_outcome` may follow the existing loader pattern (run row
visible as `STARTED` outside that transaction). After the read-only checks pass, the
`ops.run` row and the three `ops.rule_version` / `ops.run_rule_version` catalog rows
commit before the data transaction; they are not backfill data. A leftover `STARTED`
run with **zero** new backfill rows is not a committed data result.

A failed assertion, hard stop, or projection-gate failure **rolls back that
transaction**. Partial Hosted data application is not accepted.

### Append-only inserts only

The backfill **inserts** only. It **must not** UPDATE or DELETE:

- existing `raw.tabular_row` rows (including Run 72 FCM rows);
- existing `ops.projection_exception` rows (including Run 72 IDs 67–89 as stored);
- existing `obs.num_fact_observation` rows (the 950,046 facts on the source load);
- the pinned source `raw.table_load`;
- `ops.artifact_processing` for `pipeline.num_load`;
- `ops.run` / `ops.run_outcome` for Run 72.

Do not mark recovered rows `OK`. Do not attach a sidecar to an existing FCM row.

The new table load’s `field_count_mismatch_count` remains the naive extra-tab count
(23), including `QUOTED_RECOVERY` (ADR 0019 mechanic 4).

### Retry and resume

Distinguish these outcomes. Do not “resume” a half-applied load.

| Outcome | Meaning | Next action |
| --- | --- | --- |
| **Clean abort** | Transaction rolled back. Zero new `table_load`, `QUOTED_RECOVERY` rows, sidecars, backfill exceptions, and backfill facts on the pinned artifact. A leftover `STARTED` `NUM_QUOTED_RECOVERY_BACKFILL` run with no processing row is allowed. | Retry may be allowed under the **same** Hosted approval. |
| **Committed partial or success** | Any new backfill `table_load`, QR row, sidecar, exception, fact, or `LOADED` processing row exists for this `rule_code` on the pinned artifact. | **No** automatic retry or resume. Stop and investigate. A later Hosted retry needs a new explicit approval and a written finding that the first apply is a no-op or was fully rolled back. |
| **Successful rerun** | `LOADED` already exists for `pipeline.num_quoted_recovery_backfill` on any version. | No-op via the dedicated rule-code ledger. Insert no data. The read-only skip also inserts no catalog rows; a skip inside the transaction keeps the run's committed rule links. |

### Validation and projection (D1–D3, D5–D6, D10–D11)

ADR 0019 D1–D3, D5–D8, D10–D12 stay in force. This ADR does not grant a D6 bypass
(ADR 0020 case B remains unauthorized).

Local lock classification (quoted width 11 for all 23; not a promise of 23 facts):

- **D6 pass lines:** 1790, 18371, 273144, 273311, 433063, 639900, 640021, 640154,
  647250, 825968, 828926, 841844, 949170.
- **D6 fail lines:** 634367, 638720, 639901, 640022, 643855, 652709, 793877, 802489,
  806821, 816624.

D6-fail rows store recovery diagnostics and a `FOOTLEN_MISMATCH` exception. They do
**not** project facts.

D6-pass rows may project **only if** every existing fail-closed NUM gate also passes
(`obs.check_row_projection`, `obs.check_num_fact_observation`, accession `adsh`,
non-empty tag/version/uom, `YYYYMMDD` `ddate`, non-negative integer `qtrs`, empty-or-decimal
value, and a matching `registry.filing`). **Do not promise that all 13 D6-pass lines
become facts.**

The gates keep their existing `obs.projection.num` v3 behavior:

- An orphan `adsh` (no matching `registry.filing`) keeps the row raw-only with an
  `ORPHAN_ADSH` exception, exactly as in an ordinary NUM load. It does not abort.
- Any other projection-gate failure (accession format, empty tag, version, or uom,
  `ddate`, `qtrs`, value, or a database projection trigger) **aborts and rolls back the
  entire backfill transaction**. No row of the backfill commits, including rows that
  passed. There is no exception kind for these failures, and this ADR adds no new
  exception-writing path; the outcome is a clean abort under *Retry and resume*.

Identifier members come from recovered `segments` without trimming (D5). Fail-closed
zero later currency binds on T1 members remain accepted (ADR 0019).

### Explicit exclusions

- **No currency binding.** Do not run `num:bind-currency` (ADR 0016, ADR 0019 D12).
- **No Run 72 replay** and no full August `num:load`.
- **No SQL quoted-TSV splitting.**
- **No D6 bypass** and no Admin review UI (ADR 0020).
- **No SOI/TXT recovery** (ADR 0019 D7).
- **No change** to other data-set ZIPs or future ordinary NUM loads.

### Preconditions before Hosted execution

All of the following are required, in order, once the command exists. Acceptance of
this ADR authorizes only the local rehearsal; the Hosted steps need separate approval.

1. **Local rehearsal** on Docker against a pre-recovery baseline: the local August 2026
   ZIP loaded by pre-0065 code (a worktree at `a0a4808`, which writes the 23 lines as
   `FIELD_COUNT_MISMATCH` under parser v2), then 0063–0066 applied from the current
   tree. A load by current code is not a baseline: it writes `QUOTED_RECOVERY` rows
   directly. Hosted is not the first run.
2. **Fresh Hosted read-only preflight** scoped to the pinned SHA / `SEC_BDC_DATASET_ZIP`
   artifact: 0063–0066 checksums; exactly one matching artifact; that artifact’s source
   NUM `table_load_id` and its parser version (not `parser.sec_num_tsv` v3); the 23
   locks on that load; skip of `pipeline.num_load` on that
   artifact; no prior `LOADED` for `pipeline.num_quoted_recovery_backfill` on that
   artifact. Use the Hosted ids; do not invent them here.
3. **Exact assertions** (below) recorded before and after, scoped to that artifact and
   source load.
4. **Separate written approval** to run the command once on Hosted. Prefix
   `BDC_PIPELINE_ALLOW_HOSTED` on that command only; do not persist it.

### Assertions

All counts below are **for the pinned artifact** (and, where named, its pinned source
NUM `table_load`). They are not database-wide.

**Pre-run (Hosted, read-only)**

- 0063–0066 present with the repository checksums.
- Exactly one `raw.artifact` with the pinned SHA and `SEC_BDC_DATASET_ZIP`.
- That artifact has exactly one NUM `table_load`: `row_count = 950069`,
  `field_count_mismatch_count = 23`. Pin its id.
- That source load's `parser_rule_version_id` is not `parser.sec_num_tsv` v3.
- Facts whose `tabular_row` belongs to that source load: count = 950046; none of
  those facts have `recorded_at` at or after migration 0066.
- On that artifact: sidecar count = 0; `QUOTED_RECOVERY` count = 0;
  `FOOTLEN_MISMATCH` count = 0.
- The 23 source-load FCM rows match the lock table exactly (status, line, hash).
- `pipeline.num_load` is already `LOADED` for that artifact (any version).
- `pipeline.num_quoted_recovery_backfill` has no `LOADED` row for that artifact.

**Post-run**

- Pinned source NUM `table_load`, its 23 FCM rows, Run 72 exceptions on those rows,
  and its 950,046 facts are unchanged (same ids, parse status, and `recorded_at`).
- That artifact has exactly one **new** NUM `table_load` from this command: 23 rows,
  23 `QUOTED_RECOVERY`, 23 sidecars.
- New `FOOTLEN_MISMATCH` rows for that new load = 10.
- New facts for that new load ≤ 13, all on new `tabular_row_id`s, using current
  `obs.projection.num` v3. None come from D6-fail lines.
- `num:load` still skips this artifact.
- `ops.artifact_processing` has one `LOADED` row for
  `pipeline.num_quoted_recovery_backfill` on this artifact. `pipeline.num_load`
  processing rows are unchanged.

### Relationship to ADR 0019 and 0020

- ADR 0019 remains Accepted. D1–D3, D5–D8, and D10–D12 are unchanged.
- D4 is amended **only** to allow projection from **new** `QUOTED_RECOVERY` rows created
  by this backfill. It still forbids retroactive projection of the stored Run 72 FCM
  rows.
- D9 is amended **only** to allow this pinned 23-row insert. It still forbids rewriting
  Run 72 and forbids replaying `num:load` for August 2026.
- ADR 0020 remains future Admin review of later quarantined recoveries. This backfill
  is not that review path.

## Consequences

- Ordinary future NUM loads continue to use ADR 0019 recovery without touching August
  2026 history.
- Operators cannot treat ADR acceptance as a Hosted run license.
- Currency for any newly projected facts stays unbound until a separate ADR 0016
  approval.
- The implementation is a new command and an ensure-only catalog rule. Schema
  0065/0066 already provide the sidecar and gates; no migration is added.

### Implementation and rehearsal record

- Command `num:recover-quoted`; `rule_code` `pipeline.num_quoted_recovery_backfill`;
  `rule_kind` `EXTRACTION`; `run_kind` `NUM_QUOTED_RECOVERY_BACKFILL`; registered at
  run time through `ensureAndLinkRuleForRun` only.
- Local rehearsal on the `a0a4808` baseline: one new load of 23 `QUOTED_RECOVERY` rows
  and 23 sidecars, 10 `FOOTLEN_MISMATCH` exceptions on the D6-fail lines, 0
  `ORPHAN_ADSH`, and 13 facts on the 13 D6-pass lines. The source load, its rows,
  exceptions, and facts were unchanged; a rerun was a no-op.
- Final-code rehearsal (rule v1 definition SHA-256
  `0050aafb4f7812fe706efc0890556cdbc64a78c1281eabca3b9b2db74b3f61b6`) on fresh disposable
  baselines reproduced the same result. A rerun and a rerun with a bumped rule version
  were read-only skips. An induced failure at the first fact insert rolled back all
  backfill data. Two concurrent runs applied once; the other skipped inside the
  transaction.

### Unresolved until Hosted preflight

- Hosted `artifact_id` and source `table_load_id` (preflight only; not invented here).
- Hosted fact yield. The local rehearsal projected 13 facts; the Hosted count is
  confirmed only by the post-run assertions.
