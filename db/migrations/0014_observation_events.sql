-- 0014 P9-min observation events.
-- One supported event: the earliest reported_date observation for a LINKED filing registrant
-- inside an explicit observation list. It is not an instrument, exposure, or valuation event.
-- Missing dates are not rows. COST and fair value are not columns.

CREATE TABLE derived.observation_event (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_code               text NOT NULL CHECK (event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'),
  position_observation_id  bigint NOT NULL REFERENCES obs.position_observation (id),
  reported_date            date NOT NULL,
  evidence_id              bigint NOT NULL REFERENCES evidence.evidence (id),
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  rationale                text NOT NULL CHECK (btrim(rationale) <> ''),
  recorded_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE derived.observation_event IS
  'A derived event anchored to one position observation. P9-min stores only REGISTRANT_FIRST_OBSERVED_NAME. No amount, instrument, CIK, or economic group.';

CREATE FUNCTION derived.check_observation_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  po obs.position_observation;
  rule_kind ops.rule_kind;
BEGIN
  SELECT * INTO po FROM obs.position_observation WHERE id = NEW.position_observation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event requires an existing position observation';
  END IF;
  IF NEW.evidence_id IS DISTINCT FROM po.evidence_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event evidence_id must be the position observation evidence';
  END IF;
  IF NEW.reported_date IS DISTINCT FROM po.reported_date THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event reported_date must equal the position observation reported_date';
  END IF;
  SELECT r.rule_kind INTO rule_kind FROM ops.rule_version r WHERE r.id = NEW.rule_version_id;
  IF rule_kind IS DISTINCT FROM 'DERIVATION' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCD1',
      MESSAGE = 'observation event rule_version_id must be a DERIVATION rule';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_observation_event BEFORE INSERT ON derived.observation_event
  FOR EACH ROW EXECUTE FUNCTION derived.check_observation_event();

CREATE VIEW derived.observation_event_listing AS
SELECT id, event_code, position_observation_id, reported_date, evidence_id,
       rule_version_id, run_id, rationale, recorded_at
FROM derived.observation_event;
COMMENT ON VIEW derived.observation_event_listing IS
  'Observation events with their evidence link. No amount and no instrument identity.';

SELECT ops.grant_layer_privileges();
SELECT ops.apply_append_only_to_all();
