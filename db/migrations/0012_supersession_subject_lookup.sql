-- 0012 supersession subject lookup (Phase 3 performance).
-- Replaces the unindexable to_jsonb(t) subject scan in ops.check_supersession with real
-- column predicates so single_chain first inserts can use btree indexes. Semantics and
-- BDCS1 errors are unchanged. No unique constraint is added on SOI business columns.

CREATE OR REPLACE FUNCTION ops.check_supersession() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cols text[] := string_to_array(TG_ARGV[0], ',');
  chain_mode text := TG_ARGV[1];
  subject_match text;
  found boolean;
BEGIN
  SELECT string_agg(format('t.%I IS NOT DISTINCT FROM ($1).%I', btrim(c), btrim(c)), ' AND ' ORDER BY ord)
    INTO subject_match
  FROM unnest(cols) WITH ORDINALITY AS x(c, ord);

  IF NEW.supersedes_id IS NULL THEN
    IF NEW.supersede_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersede_reason given without supersedes_id', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    IF chain_mode = 'single_chain' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE %s)',
                     TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
        INTO found USING NEW;
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
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE t.id = ($1).supersedes_id AND %s)',
                   TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
      INTO found USING NEW;
    IF NOT found THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersedes_id must reference a row of the same table with the same subject (%s)',
                         TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
    END IF;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION ops.check_supersession() IS
  'G-10: first single_chain insert rejects an existing subject; a superseding row must share subject columns and carry a reason. Subject match uses table columns so a btree index can be used.';

CREATE OR REPLACE FUNCTION ops.add_supersession(rel regclass, subject_columns text, chain_mode text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  short_name text := (SELECT relname FROM pg_class WHERE oid = rel);
  col text;
  col_list text;
BEGIN
  IF chain_mode NOT IN ('single_chain', 'multi') THEN
    RAISE EXCEPTION 'chain_mode must be single_chain or multi';
  END IF;
  FOREACH col IN ARRAY string_to_array(subject_columns, ',') LOOP
    col := btrim(col);
    IF col = '' OR NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = col
    ) THEN
      RAISE EXCEPTION 'ops.add_supersession: % is not a column of %', col, rel;
    END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (supersedes_id IS DISTINCT FROM id)',
                 rel, short_name || '_not_self_superseding');
  EXECUTE format('CREATE UNIQUE INDEX %I ON %s (supersedes_id) WHERE supersedes_id IS NOT NULL',
                 short_name || '_supersedes_once', rel);
  EXECUTE format('CREATE TRIGGER check_supersession BEFORE INSERT ON %s FOR EACH ROW '
                 'EXECUTE FUNCTION ops.check_supersession(%L, %L)', rel, subject_columns, chain_mode);
  IF chain_mode = 'single_chain' THEN
    SELECT string_agg(format('%I', btrim(c)), ', ' ORDER BY ord)
      INTO col_list
    FROM unnest(string_to_array(subject_columns, ',')) WITH ORDINALITY AS x(c, ord);
    EXECUTE format('CREATE INDEX %I ON %s (%s)', short_name || '_subject_idx', rel, col_list);
  END IF;
END
$$;

-- Existing single_chain tables. filing_relationship_decision already has a matching
-- (filing_id, relationship_type) index from 0010; do not duplicate it.
CREATE INDEX soi_row_classification_subject_idx
  ON obs.soi_row_classification (soi_row_observation_id);
CREATE INDEX position_field_value_subject_idx
  ON obs.position_field_value (position_observation_id, field_code, source_column_label);
CREATE INDEX coverage_assertion_subject_idx
  ON ops.coverage_assertion (registrant_id, dataset_release_id, reporting_period_end, source_type_code, coverage_aspect);
CREATE INDEX source_column_mapping_subject_idx
  ON ref.source_column_mapping (source_table_code, column_label, field_code);
CREATE INDEX entity_resolution_decision_subject_idx
  ON resolution.entity_resolution_decision (borrower_name_observation_id);
CREATE INDEX group_membership_decision_subject_idx
  ON resolution.group_membership_decision (legal_entity_id, economic_group_id);
CREATE INDEX instrument_resolution_decision_subject_idx
  ON resolution.instrument_resolution_decision (position_observation_id, position_observation_group_id);
CREATE INDEX position_continuity_decision_subject_idx
  ON resolution.position_continuity_decision (position_observation_id);
CREATE INDEX evidence_status_assertion_subject_idx
  ON validation.evidence_status_assertion (field_value_id);

SELECT ops.apply_append_only_to_all();
