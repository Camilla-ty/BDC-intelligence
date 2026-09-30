-- 0006 observations: typed projections of raw rows.
-- SOI has no natural key. Every raw SOI row gets its own observation, and every SOI row with
-- an identifier gets its own position observation. Duplicates (same accession, identifier,
-- date, qtrs) are kept as separate rows. Potential sameness is only ever expressed as a
-- rule-versioned group with a resolution state. No unique constraint here uses business
-- columns; the only unique keys are provenance (source row + rule version) or link pairs.

CREATE FUNCTION obs.cell_by_label(p_row_id bigint, p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT r.cells[array_position(tl.header, p_label)]
  FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
  WHERE r.id = p_row_id
$$;

CREATE FUNCTION obs.check_row_projection(p_table text, p_row_id bigint, p_filing_id bigint, p_evidence_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = p_row_id AND tl.table_code = p_table AND r.parse_status = 'OK'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('source row must be an OK row of a %s table load', p_table);
  END IF;
  IF obs.cell_by_label(p_row_id, 'adsh') IS DISTINCT FROM
     (SELECT f.accession_number FROM registry.filing f WHERE f.id = p_filing_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing_id must be the filing whose accession equals the row adsh cell';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence.evidence e WHERE e.id = p_evidence_id AND e.tabular_row_id = p_row_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the same source row';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- SOI rows
-- ---------------------------------------------------------------------------

CREATE TABLE obs.soi_row_observation (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabular_row_id      bigint NOT NULL REFERENCES raw.tabular_row (id),
  filing_id           bigint NOT NULL REFERENCES registry.filing (id),
  reported_date_raw   text NOT NULL,
  reported_date       date,
  date_precision      text NOT NULL CHECK (date_precision IN ('MONTH_END_ROUNDED')),
  qtrs_raw            text NOT NULL,
  qtrs                integer CHECK (qtrs >= 0),
  duration_kind       ref.duration_kind NOT NULL,
  identifier_raw      text CHECK (identifier_raw <> ''),
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id         bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabular_row_id, rule_version_id),
  CHECK (duration_kind = CASE WHEN qtrs IS NULL THEN 'UNKNOWN'::ref.duration_kind
                              WHEN qtrs = 0 THEN 'POINT_IN_TIME'::ref.duration_kind
                              ELSE 'DURATION'::ref.duration_kind END)
);
COMMENT ON TABLE obs.soi_row_observation IS 'Exactly one per raw SOI row per rule version. Not unique on accession, identifier, date, or qtrs: SOI has no natural key.';
COMMENT ON COLUMN obs.soi_row_observation.identifier_raw IS 'Investment identifier text exactly as disclosed; NULL when the cell is empty.';

CREATE FUNCTION obs.check_soi_row_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM obs.check_row_projection('SOI', NEW.tabular_row_id, NEW.filing_id, NEW.evidence_id);
  IF NEW.reported_date_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'ddate')
     OR NEW.qtrs_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'qtrs')
     OR NEW.identifier_raw IS DISTINCT FROM
        nullif(obs.cell_by_label(NEW.tabular_row_id, 'Investment, Identifier Axis'), '') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'raw ddate, qtrs, and identifier must equal the source row cells';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_soi_row_observation BEFORE INSERT ON obs.soi_row_observation
  FOR EACH ROW EXECUTE FUNCTION obs.check_soi_row_observation();

CREATE TABLE obs.soi_row_classification (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  soi_row_observation_id  bigint NOT NULL REFERENCES obs.soi_row_observation (id),
  row_kind                ref.row_kind NOT NULL,
  period_role             ref.period_role NOT NULL,
  rule_version_id         bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                  bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id           bigint REFERENCES obs.soi_row_classification (id),
  supersede_reason        text,
  recorded_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE obs.soi_row_classification IS 'Rule-versioned classification of a SOI row. Selecting current holdings is OPEN QUESTION Q6; UNRESOLVED is valid.';
SELECT ops.add_supersession('obs.soi_row_classification', 'soi_row_observation_id', 'single_chain');

-- ---------------------------------------------------------------------------
-- NUM facts (needed for units and currency; the SOI-to-NUM join is observed, not documented)
-- ---------------------------------------------------------------------------

CREATE TABLE obs.num_fact_observation (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabular_row_id         bigint NOT NULL REFERENCES raw.tabular_row (id),
  filing_id              bigint NOT NULL REFERENCES registry.filing (id),
  tag                    text NOT NULL CHECK (tag <> ''),
  tag_version            text NOT NULL CHECK (tag_version <> ''),
  reported_date_raw      text NOT NULL,
  reported_date          date,
  qtrs_raw               text NOT NULL,
  qtrs                   integer CHECK (qtrs >= 0),
  duration_kind          ref.duration_kind NOT NULL,
  uom_raw                text NOT NULL,
  segments_raw           text,
  identifier_member_raw  text CHECK (identifier_member_raw <> ''),
  value_raw              text NOT NULL,
  value_numeric          numeric,
  value_state            ref.value_state NOT NULL CHECK (value_state IN ('REPORTED', 'UNKNOWN')),
  rule_version_id        bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id            bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                 bigint NOT NULL REFERENCES ops.run (id),
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabular_row_id, rule_version_id),
  CHECK ((value_state = 'REPORTED') = (value_numeric IS NOT NULL)),
  CHECK (value_numeric IS DISTINCT FROM 0 OR ops.text_is_numeric_zero(value_raw)),
  CHECK (duration_kind = CASE WHEN qtrs IS NULL THEN 'UNKNOWN'::ref.duration_kind
                              WHEN qtrs = 0 THEN 'POINT_IN_TIME'::ref.duration_kind
                              ELSE 'DURATION'::ref.duration_kind END)
);
COMMENT ON COLUMN obs.num_fact_observation.identifier_member_raw IS 'Typed member of the investment identifier axis, parsed from segments by the rule version.';

CREATE FUNCTION obs.check_num_fact_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM obs.check_row_projection('NUM', NEW.tabular_row_id, NEW.filing_id, NEW.evidence_id);
  IF NEW.value_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'value')
     OR NEW.uom_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'uom') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw value and uom must equal the source row cells';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_num_fact_observation BEFORE INSERT ON obs.num_fact_observation
  FOR EACH ROW EXECUTE FUNCTION obs.check_num_fact_observation();

-- ---------------------------------------------------------------------------
-- Position observations: one per SOI identifier row, never merged
-- ---------------------------------------------------------------------------

CREATE TABLE obs.position_observation (
  id                             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin_soi_row_observation_id  bigint NOT NULL REFERENCES obs.soi_row_observation (id),
  filing_id                      bigint NOT NULL REFERENCES registry.filing (id),
  reported_date                  date,
  date_precision                 text NOT NULL CHECK (date_precision IN ('MONTH_END_ROUNDED')),
  duration_kind                  ref.duration_kind NOT NULL,
  holding_descriptor_raw         text NOT NULL CHECK (holding_descriptor_raw <> ''),
  rule_version_id                bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id                    bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                         bigint NOT NULL REFERENCES ops.run (id),
  recorded_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_soi_row_observation_id, rule_version_id)
);
COMMENT ON TABLE obs.position_observation IS 'A registrant''s disclosed holding line in one filing, from exactly one SOI row. Instrument and position links exist only as resolution decisions.';

CREATE FUNCTION obs.check_position_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s obs.soi_row_observation;
BEGIN
  SELECT * INTO s FROM obs.soi_row_observation WHERE id = NEW.origin_soi_row_observation_id;
  IF s.filing_id <> NEW.filing_id
     OR s.reported_date IS DISTINCT FROM NEW.reported_date
     OR s.date_precision <> NEW.date_precision
     OR s.duration_kind <> NEW.duration_kind
     OR s.identifier_raw IS DISTINCT FROM NEW.holding_descriptor_raw THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'position observation must match its origin SOI row (filing, date, duration, identifier)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence.evidence e WHERE e.id = NEW.evidence_id AND e.tabular_row_id = s.tabular_row_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the origin SOI row';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_position_observation BEFORE INSERT ON obs.position_observation
  FOR EACH ROW EXECUTE FUNCTION obs.check_position_observation();

CREATE TABLE obs.position_observation_source (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id  bigint NOT NULL REFERENCES obs.position_observation (id),
  soi_row_observation_id   bigint NOT NULL REFERENCES obs.soi_row_observation (id),
  source_role              ref.source_role NOT NULL,
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position_observation_id, soi_row_observation_id)
);

CREATE FUNCTION obs.check_position_observation_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation p JOIN obs.soi_row_observation s ON s.id = NEW.soi_row_observation_id
    WHERE p.id = NEW.position_observation_id AND p.filing_id = s.filing_id
      AND (NEW.source_role <> 'PRIMARY' OR p.origin_soi_row_observation_id = s.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'source rows must be from the same filing; the PRIMARY source must be the origin row';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_position_observation_source BEFORE INSERT ON obs.position_observation_source
  FOR EACH ROW EXECUTE FUNCTION obs.check_position_observation_source();

-- Checked at commit: a position observation cannot exist without its PRIMARY source link.
CREATE FUNCTION obs.require_position_observation_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation_source s
    WHERE s.position_observation_id = NEW.id AND s.source_role = 'PRIMARY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = format('position observation %s has no PRIMARY source link', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER require_position_observation_source
  AFTER INSERT ON obs.position_observation DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obs.require_position_observation_source();

-- ---------------------------------------------------------------------------
-- Groups: rule-versioned "may be the same holding line" sets (duplicates, lots, comparatives)
-- ---------------------------------------------------------------------------

CREATE TABLE obs.position_observation_group (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id         bigint NOT NULL REFERENCES registry.filing (id),
  state             ref.resolution_state NOT NULL,
  rationale         text NOT NULL CHECK (btrim(rationale) <> ''),
  rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id     bigint REFERENCES obs.position_observation_group (id),
  supersede_reason  text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
SELECT ops.add_supersession('obs.position_observation_group', 'filing_id', 'multi');

CREATE TABLE obs.position_observation_group_member (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id                 bigint NOT NULL REFERENCES obs.position_observation_group (id),
  position_observation_id  bigint NOT NULL REFERENCES obs.position_observation (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, position_observation_id)
);

CREATE FUNCTION obs.check_group_member() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation_group g JOIN obs.position_observation p ON p.filing_id = g.filing_id
    WHERE g.id = NEW.group_id AND p.id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'group members must be from the group filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_group_member BEFORE INSERT ON obs.position_observation_group_member
  FOR EACH ROW EXECUTE FUNCTION obs.check_group_member();

CREATE FUNCTION obs.require_group_member() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM obs.position_observation_group_member m WHERE m.group_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1', MESSAGE = format('group %s has no members', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER require_group_member
  AFTER INSERT ON obs.position_observation_group DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obs.require_group_member();

-- ---------------------------------------------------------------------------
-- Field values: raw next to normalized, with explicit value, currency, and scale states
-- ---------------------------------------------------------------------------

CREATE TABLE obs.position_field_value (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id         bigint NOT NULL REFERENCES obs.position_observation (id),
  field_code                      text NOT NULL REFERENCES ref.field_definition (field_code),
  column_mapping_id               bigint REFERENCES ref.source_column_mapping (id),
  source_column_label             text,
  source_column_position          integer CHECK (source_column_position >= 1),
  raw_value                       text,
  normalized_numeric              numeric,
  normalized_date                 date,
  normalized_text                 text,
  unit_code                       text,
  currency_code                   text CHECK (currency_code ~ '^[A-Z]{3}$'),
  currency_state                  ref.currency_state NOT NULL,
  scale_state                     ref.scale_state NOT NULL,
  value_state                     ref.value_state NOT NULL CHECK (value_state <> 'DERIVED'),
  unknown_reason                  text,
  not_applicable_reason           text,
  normalization_rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id                     bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                          bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id                   bigint REFERENCES obs.position_field_value (id),
  supersede_reason                text,
  recorded_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_value_source_column CHECK ((source_column_label IS NULL) = (source_column_position IS NULL)),
  CONSTRAINT field_value_mapping_needs_column CHECK (column_mapping_id IS NULL OR source_column_label IS NOT NULL),
  CONSTRAINT field_value_single_normalized CHECK (num_nonnulls(normalized_numeric, normalized_date, normalized_text) <= 1),
  CONSTRAINT field_value_reported CHECK (value_state <> 'REPORTED' OR (
    raw_value IS NOT NULL AND (
      num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 1
      OR scale_state = 'UNRESOLVED'))),
  CONSTRAINT field_value_unknown CHECK (value_state <> 'UNKNOWN' OR (
    num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 0
    AND coalesce(btrim(unknown_reason), '') <> '')),
  CONSTRAINT field_value_not_applicable CHECK (value_state <> 'NOT_APPLICABLE' OR (
    num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 0
    AND coalesce(btrim(not_applicable_reason), '') <> '')),
  CONSTRAINT field_value_zero_only_if_disclosed CHECK (
    normalized_numeric IS DISTINCT FROM 0 OR ops.text_is_numeric_zero(raw_value)),
  CONSTRAINT field_value_currency CHECK (
    (currency_code IS NULL) = (currency_state IN ('UNKNOWN', 'AMBIGUOUS')))
);
COMMENT ON TABLE obs.position_field_value IS 'One field of one position observation. A field with no row is UNKNOWN in the views, never zero. Authority is computed by obs.field_value_authority.';

SELECT ops.add_supersession('obs.position_field_value', 'position_observation_id,field_code,source_column_label', 'single_chain');

CREATE FUNCTION obs.check_position_field_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fd ref.field_definition;
  m ref.source_column_mapping;
  origin_row bigint;
BEGIN
  SELECT * INTO fd FROM ref.field_definition WHERE field_code = NEW.field_code;
  IF (NEW.normalized_numeric IS NOT NULL AND fd.value_type <> 'NUMERIC')
     OR (NEW.normalized_date IS NOT NULL AND fd.value_type <> 'DATE')
     OR (NEW.normalized_text IS NOT NULL AND fd.value_type <> 'TEXT') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('field %s takes %s values only', fd.field_code, fd.value_type);
  END IF;
  IF NEW.value_state = 'REPORTED' AND NEW.column_mapping_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM evidence.evidence e WHERE e.id = NEW.evidence_id AND e.evidence_level = 'L2_ORIGINAL_FILING'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a REPORTED value needs a source column mapping or Level 2 (original filing) evidence';
  END IF;
  IF NEW.column_mapping_id IS NOT NULL THEN
    SELECT * INTO m FROM ref.source_column_mapping WHERE id = NEW.column_mapping_id;
    IF m.field_code IS DISTINCT FROM NEW.field_code OR m.column_label <> NEW.source_column_label THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'column_mapping_id must map source_column_label to field_code';
    END IF;
  END IF;
  IF NEW.source_column_label IS NOT NULL THEN
    SELECT s.tabular_row_id INTO origin_row
    FROM obs.position_observation p JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE p.id = NEW.position_observation_id;
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = origin_row
        AND tl.header[NEW.source_column_position] = NEW.source_column_label
        AND r.cells[NEW.source_column_position] IS NOT DISTINCT FROM NEW.raw_value
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'source column label, position, and raw value must match the origin SOI row';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_position_field_value BEFORE INSERT ON obs.position_field_value
  FOR EACH ROW EXECUTE FUNCTION obs.check_position_field_value();

CREATE TABLE obs.field_value_corroboration (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_value_id           bigint NOT NULL REFERENCES obs.position_field_value (id),
  num_fact_observation_id  bigint REFERENCES obs.num_fact_observation (id),
  outcome                  ref.corroboration_outcome NOT NULL,
  join_basis               text NOT NULL CHECK (join_basis IN ('DOCUMENTED', 'OBSERVED_UNDOCUMENTED')),
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((num_fact_observation_id IS NOT NULL) = (outcome IN ('EQUAL', 'NOT_EQUAL')))
);

CREATE FUNCTION obs.check_field_value_corroboration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.num_fact_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.position_field_value f
    JOIN obs.position_observation p ON p.id = f.position_observation_id
    JOIN obs.num_fact_observation n ON n.id = NEW.num_fact_observation_id
    WHERE f.id = NEW.field_value_id AND n.filing_id = p.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'corroborating NUM fact must be from the same filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_field_value_corroboration BEFORE INSERT ON obs.field_value_corroboration
  FOR EACH ROW EXECUTE FUNCTION obs.check_field_value_corroboration();

-- ---------------------------------------------------------------------------
-- Borrower name observations (splitting the identifier is OPEN QUESTION Q5)
-- ---------------------------------------------------------------------------

CREATE TABLE obs.borrower_name_observation (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id  bigint NOT NULL REFERENCES obs.position_observation (id),
  source_column_label      text NOT NULL,
  source_column_position   integer NOT NULL CHECK (source_column_position >= 1),
  raw_text                 text NOT NULL CHECK (raw_text <> ''),
  normalized_text          text,
  extraction_state         text NOT NULL CHECK (extraction_state IN ('RAW_ONLY', 'EXTRACTED', 'UNRESOLVED')),
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id              bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((extraction_state = 'EXTRACTED') = (normalized_text IS NOT NULL))
);
COMMENT ON TABLE obs.borrower_name_observation IS 'Name text as disclosed. It is an observation, not a legal entity; linking happens only through resolution decisions.';

-- ---------------------------------------------------------------------------
-- Equivalence across artifact versions (SEC refreshes) without overwriting
-- ---------------------------------------------------------------------------

CREATE TABLE obs.observation_equivalence (
  id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabular_row_id               bigint NOT NULL REFERENCES raw.tabular_row (id),
  equivalent_tabular_row_id    bigint NOT NULL REFERENCES raw.tabular_row (id),
  basis                        text NOT NULL CHECK (basis IN ('RAW_LINE_SHA256_EQUAL')),
  rule_version_id              bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabular_row_id, equivalent_tabular_row_id, rule_version_id),
  CHECK (tabular_row_id <> equivalent_tabular_row_id)
);

CREATE FUNCTION obs.check_observation_equivalence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM raw.tabular_row a JOIN raw.table_load la ON la.id = a.table_load_id,
         raw.tabular_row b JOIN raw.table_load lb ON lb.id = b.table_load_id
    WHERE a.id = NEW.tabular_row_id AND b.id = NEW.equivalent_tabular_row_id
      AND a.raw_line_sha256 = b.raw_line_sha256 AND la.artifact_id <> lb.artifact_id
      AND la.table_code = lb.table_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'equivalent rows must have equal raw_line_sha256, the same table, and different artifacts';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_observation_equivalence BEFORE INSERT ON obs.observation_equivalence
  FOR EACH ROW EXECUTE FUNCTION obs.check_observation_equivalence();

SELECT ops.apply_append_only_to_all();
