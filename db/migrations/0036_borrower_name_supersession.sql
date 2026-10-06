-- 0036 borrower-name supersession.
-- A later rule records a new borrower-name row that points at the row it replaces.
-- The earlier row stays. This migration inserts no observations, evidence, or decisions.
-- raw_text is not frozen: a later row may correct a capture when its reason says so.
-- A successor that changes neither the rule, the extraction state, nor the normalized text is rejected.

ALTER TABLE obs.borrower_name_observation
  ADD COLUMN supersedes_id bigint REFERENCES obs.borrower_name_observation (id),
  ADD COLUMN supersede_reason text;

COMMENT ON COLUMN obs.borrower_name_observation.supersedes_id IS
  'The borrower-name row this row replaces. Null on a root. The replaced row is not updated.';

COMMENT ON COLUMN obs.borrower_name_observation.supersede_reason IS
  'Why this row replaces supersedes_id. Required when supersedes_id is set. Null on a root.';

SELECT ops.add_supersession(
  'obs.borrower_name_observation',
  'position_observation_id,evidence_id,name_source,source_column_label,source_column_position',
  'single_chain');

DROP INDEX obs.borrower_name_observation_filing_cell_evidence_uidx;

CREATE UNIQUE INDEX borrower_name_observation_filing_cell_root_uidx
  ON obs.borrower_name_observation (position_observation_id, evidence_id)
  WHERE name_source = 'FILING_CELL' AND supersedes_id IS NULL;

COMMENT ON INDEX obs.borrower_name_observation_filing_cell_root_uidx IS
  'One FILING_CELL root per position and evidence. A successor reuses that evidence and sets supersedes_id.';

CREATE FUNCTION obs.check_borrower_name_successor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous_rule bigint;
  previous_state text;
  previous_text text;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT rule_version_id, extraction_state, normalized_text
    INTO previous_rule, previous_state, previous_text
  FROM obs.borrower_name_observation
  WHERE id = NEW.supersedes_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF previous_rule IS NOT DISTINCT FROM NEW.rule_version_id
     AND previous_state IS NOT DISTINCT FROM NEW.extraction_state
     AND previous_text IS NOT DISTINCT FROM NEW.normalized_text THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS1',
      MESSAGE = 'obs.borrower_name_observation: a successor must change rule_version_id, extraction_state, or normalized_text';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_borrower_name_successor() IS
  'A successor must change the rule version, the extraction state, or the normalized text. raw_text may differ when the reason records a capture correction.';

CREATE TRIGGER check_borrower_name_successor
  BEFORE INSERT ON obs.borrower_name_observation
  FOR EACH ROW EXECUTE FUNCTION obs.check_borrower_name_successor();

CREATE VIEW obs.current_borrower_name_observation AS
SELECT b.*
FROM obs.borrower_name_observation b
WHERE NOT EXISTS (
  SELECT 1 FROM obs.borrower_name_observation s WHERE s.supersedes_id = b.id
);

COMMENT ON VIEW obs.current_borrower_name_observation IS
  'The head of each borrower-name chain. One position may have several heads when its cells differ. A head is not a legal entity.';

GRANT SELECT ON obs.current_borrower_name_observation TO bdc_pipeline_writer, bdc_reader;

SELECT ops.grant_layer_privileges();
SELECT ops.apply_append_only_to_all();
