-- 0001 foundation: layer schemas, roles, shared integrity functions, run and rule tables.
--
-- Custom SQLSTATEs raised by this schema (tests assert on them):
--   BDCA1  append-only violation (UPDATE, DELETE, or TRUNCATE on a history table)
--   BDCS1  invalid supersession
--   BDCL1  missing required link (provenance, source, or input)
--   BDCD1  derivation gate violation
--   BDCI1  cross-row integrity violation

CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA raw;
CREATE SCHEMA registry;
CREATE SCHEMA evidence;
CREATE SCHEMA obs;
CREATE SCHEMA identity;
CREATE SCHEMA resolution;
CREATE SCHEMA validation;
CREATE SCHEMA derived;
CREATE SCHEMA ref;

COMMENT ON SCHEMA ops IS 'Runs, rule versions, migrations, audit events, coverage assertions.';
COMMENT ON SCHEMA raw IS 'Lossless landing of source bytes and rows, before any interpretation.';
COMMENT ON SCHEMA registry IS 'SEC registrants, filings, filing documents, dataset releases.';
COMMENT ON SCHEMA evidence IS 'Locations inside source artifacts that support each fact.';
COMMENT ON SCHEMA obs IS 'Typed observations projected from raw rows. Rows are never merged.';
COMMENT ON SCHEMA identity IS 'Stable identifiers for legal entities, economic groups, instruments, positions. No facts.';
COMMENT ON SCHEMA resolution IS 'Versioned identity decisions (MATCHED, PROBABLE, UNRESOLVED, REJECTED) and candidates.';
COMMENT ON SCHEMA validation IS 'Validation results and evidence-status assertions.';
COMMENT ON SCHEMA derived IS 'Values computed by versioned deterministic rules, with their exact inputs.';
COMMENT ON SCHEMA ref IS 'Controlled vocabularies and versioned source-column mappings.';

-- Roles are cluster-wide. They carry no login; environments grant them to login roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bdc_pipeline_writer') THEN
    CREATE ROLE bdc_pipeline_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bdc_reader') THEN
    CREATE ROLE bdc_reader NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Append-only enforcement (G-10)
-- ---------------------------------------------------------------------------

CREATE FUNCTION ops.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'BDCA1',
    MESSAGE = format('%I.%I is append-only: %s is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP),
    HINT = 'Insert a new row that supersedes the previous one, with a reason.';
END
$$;

-- Attaches the append-only triggers to every base table in the layer schemas that lacks
-- them. Every migration calls this last, so no history table can be created without them.
CREATE FUNCTION ops.apply_append_only_to_all() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  attached integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                        'resolution', 'validation', 'derived', 'ref')
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        WHERE tg.tgrelid = c.oid AND tg.tgname = 'append_only_row'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER append_only_row BEFORE UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()', t.rel);
    EXECUTE format(
      'CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation()', t.rel);
    attached := attached + 1;
  END LOOP;
  RETURN attached;
END
$$;

-- ---------------------------------------------------------------------------
-- Supersession (G-10): corrections are new rows that reference the row they replace.
--   TG_ARGV[0]: comma-separated subject columns; a superseding row must share them.
--   TG_ARGV[1]: 'single_chain' = one linear history per subject (decisions, mappings);
--               'multi'        = several independent observations per subject may coexist.
-- A partial unique index on supersedes_id (added by ops.add_supersession) prevents forks.
-- ---------------------------------------------------------------------------

CREATE FUNCTION ops.check_supersession() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cols text[] := string_to_array(TG_ARGV[0], ',');
  chain_mode text := TG_ARGV[1];
  new_row jsonb := to_jsonb(NEW);
  subject_match text;
  found boolean;
BEGIN
  SELECT string_agg(format('to_jsonb(t) -> %L IS NOT DISTINCT FROM $1 -> %L', c, c), ' AND ')
    INTO subject_match
  FROM unnest(cols) AS c;

  IF NEW.supersedes_id IS NULL THEN
    IF NEW.supersede_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersede_reason given without supersedes_id', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    IF chain_mode = 'single_chain' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE %s)',
                     TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
        INTO found USING new_row;
      IF found THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCS1',
          MESSAGE = format('%I.%I: this subject already has a row; insert a row that supersedes the current one',
                           TG_TABLE_SCHEMA, TG_TABLE_NAME);
      END IF;
    END IF;
  ELSE
    IF coalesce(btrim(NEW.supersede_reason), '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: a superseding row needs a supersede_reason', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE t.id = ($1 ->> ''supersedes_id'')::bigint AND %s)',
                   TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
      INTO found USING new_row;
    IF NOT found THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersedes_id must reference a row of the same table with the same subject (%s)',
                         TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION ops.add_supersession(rel regclass, subject_columns text, chain_mode text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  short_name text := (SELECT relname FROM pg_class WHERE oid = rel);
BEGIN
  IF chain_mode NOT IN ('single_chain', 'multi') THEN
    RAISE EXCEPTION 'chain_mode must be single_chain or multi';
  END IF;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (supersedes_id IS DISTINCT FROM id)',
                 rel, short_name || '_not_self_superseding');
  EXECUTE format('CREATE UNIQUE INDEX %I ON %s (supersedes_id) WHERE supersedes_id IS NOT NULL',
                 short_name || '_supersedes_once', rel);
  EXECUTE format('CREATE TRIGGER check_supersession BEFORE INSERT ON %s FOR EACH ROW '
                 'EXECUTE FUNCTION ops.check_supersession(%L, %L)', rel, subject_columns, chain_mode);
END
$$;

-- Validates a (subject_table, subject_id) reference used by polymorphic tables.
CREATE FUNCTION ops.assert_subject_exists(subject_table text, subject_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  found boolean;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1)', subject_table::regclass)
    INTO found USING subject_id;
  IF NOT found THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('subject %s id=%s does not exist', subject_table, subject_id);
  END IF;
END
$$;

-- True only when the text is a literal zero such as "0", "0.00", or "-0".
CREATE FUNCTION ops.text_is_numeric_zero(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT value ~ '^\s*[+-]?(0+(\.0*)?|\.0+)([eE][+-]?[0-9]+)?\s*$'
$$;

-- ---------------------------------------------------------------------------
-- Vocabularies needed by ops tables
-- ---------------------------------------------------------------------------

CREATE TYPE ops.run_status AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'ABORTED');

CREATE TYPE ops.rule_kind AS ENUM (
  'PARSER', 'NORMALIZATION', 'CLASSIFICATION', 'GROUPING', 'EQUIVALENCE', 'MAPPING',
  'EXTRACTION', 'VALIDATION', 'RESOLUTION', 'DERIVATION', 'COVERAGE', 'REVIEW_PROCEDURE');

CREATE TYPE ops.unknown_input_policy AS ENUM ('REJECT_UNKNOWN_INPUTS', 'PROPAGATE_UNKNOWN');

-- ---------------------------------------------------------------------------
-- Migration ledger. The runner creates this table if absent before applying 0001, so
-- CREATE TABLE IF NOT EXISTS keeps 0001 valid in both orders.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.schema_migration (
  filename    text PRIMARY KEY CHECK (filename ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Runs and rule versions (G-12: every row records the code and rules that produced it)
-- ---------------------------------------------------------------------------

CREATE TABLE ops.run (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_kind       text NOT NULL CHECK (run_kind ~ '^[A-Z][A-Z0-9_]*$'),
  code_version   text NOT NULL CHECK (btrim(code_version) <> ''),
  input_sha256   text CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  parameters     jsonb NOT NULL,
  started_at     timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ops.run IS 'One execution of any job. A run with no ops.run_outcome row is STARTED.';
COMMENT ON COLUMN ops.run.parameters IS 'Non-secret parameters only. Never store the SEC User-Agent value.';

CREATE TABLE ops.run_outcome (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id         bigint NOT NULL UNIQUE REFERENCES ops.run (id),
  status         ops.run_status NOT NULL CHECK (status <> 'STARTED'),
  finished_at    timestamptz NOT NULL,
  counts         jsonb NOT NULL,
  error_summary  text,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'SUCCEEDED' OR error_summary IS NOT NULL)
);

CREATE TABLE ops.rule_version (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_code             text NOT NULL CHECK (rule_code ~ '^[a-z][a-z0-9_.]*$'),
  rule_kind             ops.rule_kind NOT NULL,
  version               text NOT NULL CHECK (version ~ '^[0-9A-Za-z][0-9A-Za-z._-]*$'),
  definition_sha256     text NOT NULL CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
  spec_reference        text NOT NULL CHECK (btrim(spec_reference) <> ''),
  description           text NOT NULL CHECK (btrim(description) <> ''),
  unknown_input_policy  ops.unknown_input_policy,
  created_by            text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version),
  CHECK ((rule_kind = 'DERIVATION') = (unknown_input_policy IS NOT NULL))
);
COMMENT ON TABLE ops.rule_version IS 'Immutable definition of a parser, normalization, classification, validation, resolution, or derivation rule.';
COMMENT ON COLUMN ops.rule_version.unknown_input_policy IS 'Derivation rules only: how Unknown inputs are handled. Unknown never becomes zero.';

CREATE TABLE ops.run_rule_version (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  rule_version_id  bigint NOT NULL REFERENCES ops.rule_version (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, rule_version_id)
);

CREATE TABLE ops.rule_activation (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_version_id  bigint NOT NULL REFERENCES ops.rule_version (id),
  action           text NOT NULL CHECK (action IN ('ACTIVATE', 'DEACTIVATE')),
  effective_at     timestamptz NOT NULL,
  reason           text NOT NULL CHECK (btrim(reason) <> ''),
  actor            text NOT NULL CHECK (btrim(actor) <> ''),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.audit_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_kind     text NOT NULL CHECK (event_kind ~ '^[A-Z][A-Z0-9_]*$'),
  subject_table  text CHECK (subject_table ~ '^[a-z_]+\.[a-z_]+$'),
  subject_id     text,
  actor          text NOT NULL CHECK (btrim(actor) <> ''),
  reason         text NOT NULL CHECK (btrim(reason) <> ''),
  details        jsonb,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

SELECT ops.apply_append_only_to_all();
