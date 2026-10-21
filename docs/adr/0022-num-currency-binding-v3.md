# 0022. NUM currency binding v3: unique-fact, dimension exclusions, and run checkpoints

## Status

Accepted. Amends [0016](0016-num-currency-binding.md).

## Context

ADR 0016 rule `obs.currency.from_num_unique_match` v2 promoted a head when its equal-value
NUM facts carried exactly one ISO-looking `uom`. Several equal facts in one currency
therefore promoted, linking the lowest-id fact. Facts were not checked for other axes.

A visual evidence review of August 2026 filings found three problems:

- The same identifier member can appear on a direct holding and on a joint-venture holding.
  NUM carries the joint-venture amount on a fact that also has
  `InvestmentCompanyNonconsolidatedSubsidiaryAxis`.
- NUM facts with `RangeAxis` carry a range bound (for example a maximum), not a position
  amount.
- The SOI data set exposes both dimensions as the columns `Investment Company, Nonconsolidated
  Subsidiary Axis` and `Range Axis` (`docs/SOURCE_SCHEMAS.md` 5.1). A SOI row with either cell
  filled is not a plain direct holding, even when a plain NUM fact of equal value exists.

A v2 run also had no error handling: a failure left the run `STARTED` with no outcome and no
record of which batches had committed.

## Decision

- **Rule `obs.currency.from_num_unique_match` v3.** The v2 `ops.rule_version` row and every
  successor, corroboration, and run written under it stay unchanged. v3 considers only
  current heads that are still `UNKNOWN`, so it never revisits a v2 binding.
- **Uniqueness is unique-fact.** For each head the binder looks at NUM facts with the same
  filing, reported date, identifier member, and expected tag. Facts carrying a prohibited
  axis are not eligible. Then:
  - Exactly one eligible fact with an equal value and an ISO-looking `uom` gives a
    successor with `FROM_NUM_UNIQUE_MATCH` and one `EQUAL` corroboration.
  - Two or more equal-value eligible facts give `MULTIPLE_CANDIDATES` with no fact link.
    This holds whether the facts share a unit or not. There is no `EQUAL` row.
  - One eligible fact with a different value gives `NOT_EQUAL`. Several give
    `MULTIPLE_CANDIDATES`.
  - Exactly one equal fact with a non-currency `uom` changes nothing.
- **NUM-side exclusion.** A fact is prohibited when its `segments` names
  `RangeAxis` or `InvestmentCompanyNonconsolidatedSubsidiaryAxis` at the start of a `;`
  pair, in either the typed `Axis(version)=` or the plain `Axis=` form. The check fails
  closed: text inside another member that starts a pair with either name also excludes. Each
  tagged prohibited fact for a head is recorded in
  `obs.field_value_currency_exclusion` with reason `NUM_PROHIBITED_DIMENSION` and the axis
  name. This applies even when another eligible fact binds the head. When no eligible fact
  remains, the head stays `UNKNOWN`.
- **SOI-side exclusion.** When the head's origin SOI row has a non-empty
  `Investment Company, Nonconsolidated Subsidiary Axis` or `Range Axis` cell, the head is
  excluded before NUM is consulted. A plain equal-value fact does not override this. One
  exclusion row is recorded per non-empty cell, with reason
  `SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS` or `SOI_RANGE_AXIS` and the cell exactly as
  disclosed. A header without the column reads as empty. A whitespace-only cell is not
  empty. A trigger rejects an exclusion whose stored cell differs from the origin row, or
  whose NUM fact is from another filing or lacks the axis.
- **Currency stays per field.** Each monetary field binds only to its own tag's fact.
  Different currencies on principal, cost, and fair value of one holding stay as disclosed.
  There is no USD inference, no FX conversion, and no ISO reference list. The code shape
  check (`^[A-Z]{3}$`) is unchanged.
- **Run checkpoints.** Every batch transaction writes its writes and one
  `ops.num_currency_bind_batch` row together. The row holds the run, rule, batch index,
  head-id range, head count, and rows written. A trigger requires consecutive indexes,
  ranges that do not overlap, a rule linked to the run, and a run with no outcome yet.
- **Failure accounting.** On any error after the run row exists, the binder writes
  `ops.run_outcome` `FAILED` and then rethrows. The counts come from committed checkpoints:
  batches, heads, successors, corroborations, and exclusions. They also record the failing
  phase, the batch index, and the head-id range in flight. `error_summary` holds the error
  text with any connection string redacted. If the `FAILED` row cannot be written, the
  error says so and the run stays `STARTED`.
- **Run liveness (migration 0068).** A binder run starts through
  `ops.start_num_currency_bind_run` on a dedicated session. The same statement inserts the
  run and takes the session advisory lock `(81202610, run_id)`, and the session stays open
  until the run ends. PostgreSQL releases a session advisory lock when the server session
  holding it ends, or when that session releases it. Run `parameters` record
  `liveness_lock_class = 81202610`. Three events are kept apart: the binder's client
  connection ending, the lock being released, and the PostgreSQL backend terminating. They
  need not coincide; through a session pooler, a client can disconnect and the lock be
  released while the backend stays open. The binder relies only on whether the lock is held.
- **Liveness fence (migration 0069).** Every bind batch and the binder's `SUCCEEDED` write
  require the run's liveness lock to be held. The binder's own `FAILED` write and the rule
  links written by `registerRules` (`ops.run_rule_version`) do not require the lock; rule
  links are instead refused once the run has an outcome (migration 0070, below).
  `ops.assert_num_currency_bind_live(run_id)` raises `BDCR1` unless the run
  recorded the liveness protocol and some session in this database holds its lock in
  `pg_locks`. It is called:
  - at the start of each batch transaction, after the batch lock and before the first write;
  - from a checkpoint trigger, which fires after the 0067 checkpoint checks;
  - in the binder's `SUCCEEDED` write, which takes the batch lock as well.

  A failed check rolls back the whole batch, so a binder whose liveness lock is no longer
  held cannot commit another batch or claim `SUCCEEDED`.
- **Abandon.** `npm run num:bind-currency -- --abandon RUN_ID --actor NAME --reason TEXT`
  calls `ops.abandon_num_currency_bind_run`. It first takes the batch lock, so no batch is in
  flight. It then requires that the run:
  - is a `NUM_CURRENCY_BIND` run with no outcome;
  - recorded the liveness protocol (older runs cannot be shown to have stopped and are refused);
  - has a free liveness lock (otherwise it is refused as still active).

  A batch needs the lock held and abandon needs it free, and both decide under the batch lock.
  They are therefore serialized and can never both proceed. It writes `ABORTED` with the
  committed checkpoint counts plus `abandoned = true`. `error_summary` holds the actor, the
  reason, and only what the free lock shows: no database session held it, so no later bind
  batch, rule link, or outcome of the run can commit. An `ops.audit_event` row
  (`NUM_CURRENCY_BIND_ABANDONED`) is written. Checkpoints are kept. Because the run now has an
  outcome:
  - the 0067 checkpoint trigger rejects any later batch of it, and every batch writes a
    checkpoint, so the whole batch rolls back;
  - a later `SUCCEEDED` or `FAILED` row, and a second abandon, are refused (`UNIQUE (run_id)`
    on the outcome);
  - a later rule link is refused (`BDCI1`) by the 0070 trigger on `ops.run_rule_version`. It
    acts only on `NUM_CURRENCY_BIND` runs and checks for an outcome after taking the batch
    lock, which abandon takes first. A link therefore either commits before the abandon or
    waits for it and is refused. This holds for any outcome, not only `ABORTED`.

  The 0069 wording said the run's database session had ended. Migration 0070 replaces both
  functions with the same logic and corrected messages. `ABORTED` rows written under 0069
  keep their original text.
- **Connection loss.** When the liveness connection drops while the binder process keeps
  running, the local session wrapper may exit the process once its event loop runs. The
  Hosted session wrapper only logs the error. Either way, the binder's next batch, or its
  `SUCCEEDED` write, is refused by the fence. The binder then tries to write `FAILED` with the
  committed counts on a new connection:
  - If that succeeds, the run is `FAILED` with the liveness error.
  - If an operator abandoned the run first, the `FAILED` row conflicts with the stored
    outcome. The binder reports the stored status (for example `ABORTED`) and does not claim
    `FAILED`.
  - If the database cannot be reached, no outcome can be written. The binder reports that the
    stored status is unknown. Once no session holds the liveness lock, the run can be
    abandoned.
- **Resume.** `npm run num:bind-currency -- --resume RUN_ID` starts a new run through the same
  function. Under the per-run advisory transaction lock `(81202611, prior_run_id)`, the
  function inserts the run and one `ops.num_currency_bind_resume` claim
  (`UNIQUE (prior_run_id)`). The resume is refused unless the prior run:
  - is a `NUM_CURRENCY_BIND` run;
  - is `FAILED` or `ABORTED` (a `STARTED` run may still be running, and must be abandoned first);
  - has not already been resumed;
  - used rule v3 with the current definition SHA-256.

  A refused resume inserts no run and no claim. Of two concurrent resumes, exactly one claims
  the run. The other waits on the lock and is then refused as already resumed. A resume
  recomputes from current heads: committed successors are no longer `UNKNOWN`, and
  corroboration and exclusion writes skip existing rows for the rule. The batch that failed
  is therefore retried, and nothing is duplicated. Every run's `parameters` record
  `uniqueness = unique-fact`, the batch size, and `resumes_run_id` when set. Refusals raise
  SQLSTATE `BDCR1`.

## Consequences

- v3 binds fewer heads than v2 on the same data. Heads that v2 would have bound from
  duplicate same-currency facts, or from dimensioned facts, stay `UNKNOWN` with a recorded
  reason.
- Existing v2 bindings, if any, are not re-evaluated. Remediating them would be a separate
  decision.
- A process killed outside JavaScript error handling (for example `SIGKILL` or host loss)
  still leaves its run `STARTED`. Once no session holds its liveness lock, `--abandon` marks
  it `ABORTED` and it can be resumed.
- A free liveness lock proves only that no database session holds it. It does not prove that
  the binder process, its client connection, or a PostgreSQL backend has ended. A process
  whose lock was released may still be running (for example in its planning phase) when an
  operator abandons the run. After that it cannot commit a bind batch, a rule link, or an
  outcome, and it reports the stored `ABORTED` status when it next tries. Before an abandon,
  a binder whose lock was released can still link rules to its `STARTED` run; links are
  fenced on the outcome, not on the lock. A run that ended before linking its rules (killed
  or abandoned in its rule phase) has no recorded rule identity, so `--resume` refuses it.
  It committed no batch; a new run without `--resume` recomputes from current heads.
- Hosted session pooler, one probe trial (21 October 2026). A dedicated client took a session
  advisory lock of an unused class through the session pooler (port 5432). A second
  connection saw exactly one holder, and its transaction-level try-lock was refused. After
  the holding client was killed with `SIGKILL`, the lock was gone within about 207 ms. The
  holder's PostgreSQL backend was still present and idle 60 seconds later. This is one
  trial, of one disconnect type. It does not establish behaviour after a graceful close, an
  idle client, or a network failure. How the pooler cleared the lock was not observed.
- Run ids above 2,147,483,647 do not fit the two-int lock key and are refused at start.
- The fence reads `pg_locks`. It is correct only when the connection that holds a run's
  liveness lock is the database session itself, that is, a direct connection or a
  session-mode pooler. The transaction pooler is already refused.
- Migrations 0067, 0068, and 0069 add the tables, functions, and triggers. Migration 0070
  corrects the liveness wording without changing the fence or abandon logic, and adds the
  rule-link trigger. Applying them to Hosted, and any Hosted binder run, need separate
  approval.
