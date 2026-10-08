-- 0054 auditable SOI fact-group membership.
-- A group remains a rule-versioned set of existing position observations.
-- It is not an instrument, a position, or a combined numeric observation.
-- Member role names the fact the source row already is: BALANCE, SPREAD, or PIK.
-- Member evidence must point at that same source row.

CREATE TYPE obs.soi_fact_member_role AS ENUM ('BALANCE', 'SPREAD', 'PIK');

ALTER TABLE obs.position_observation_group
  ADD COLUMN grouping_key text,
  ADD CONSTRAINT position_observation_group_key_check
    CHECK (grouping_key IS NULL OR btrim(grouping_key) <> '');

CREATE UNIQUE INDEX position_observation_group_rule_key
  ON obs.position_observation_group (rule_version_id, grouping_key)
  WHERE grouping_key IS NOT NULL;

ALTER TABLE obs.position_observation_group_member
  ADD COLUMN member_role obs.soi_fact_member_role NOT NULL,
  ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);

COMMENT ON COLUMN obs.position_observation_group.grouping_key IS
  'Deterministic identity of one fact group for one rule version. A second insert of the same key is rejected. The key does not replace the source observations.';

COMMENT ON COLUMN obs.position_observation_group_member.member_role IS
  'Fact role of this source row inside the group: BALANCE, SPREAD, or PIK. The role does not merge the row into another observation.';

COMMENT ON COLUMN obs.position_observation_group_member.evidence_id IS
  'Evidence whose tabular row is the member observation source row.';

CREATE FUNCTION obs.check_fact_group_member_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM obs.position_observation_source src
    JOIN obs.soi_row_observation s ON s.id = src.soi_row_observation_id
    JOIN evidence.evidence e ON e.id = NEW.evidence_id AND e.tabular_row_id = s.tabular_row_id
    WHERE src.position_observation_id = NEW.position_observation_id
      AND src.source_role = 'PRIMARY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'fact group member evidence must point at the member source row';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_fact_group_member_evidence
  BEFORE INSERT ON obs.position_observation_group_member
  FOR EACH ROW EXECUTE FUNCTION obs.check_fact_group_member_evidence();

CREATE FUNCTION obs.check_soi_fact_group_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rule_code text;
  n_balance integer;
  n_spread integer;
  n_pik integer;
  n_all integer;
BEGIN
  SELECT rv.rule_code INTO rule_code
  FROM ops.rule_version rv
  WHERE rv.id = NEW.rule_version_id;
  IF rule_code IS DISTINCT FROM 'obs.soi_fact_group' THEN
    RETURN NULL;
  END IF;
  IF NEW.grouping_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = 'soi fact group requires a grouping key';
  END IF;
  SELECT count(*) FILTER (WHERE m.member_role = 'BALANCE'),
         count(*) FILTER (WHERE m.member_role = 'SPREAD'),
         count(*) FILTER (WHERE m.member_role = 'PIK'),
         count(*)
    INTO n_balance, n_spread, n_pik, n_all
  FROM obs.position_observation_group_member m
  WHERE m.group_id = NEW.id;
  IF n_balance <> 1 OR n_spread <> 1 OR n_pik > 1 OR n_all <> n_balance + n_spread + n_pik
     OR n_all NOT IN (2, 3) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = 'soi fact group must be one balance row, one spread row, and at most one PIK row';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER check_soi_fact_group_shape
  AFTER INSERT ON obs.position_observation_group
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obs.check_soi_fact_group_shape();

SELECT ops.grant_layer_privileges();
