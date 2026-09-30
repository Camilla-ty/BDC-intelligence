-- 0007 identity and resolution.
-- G-14: legal entity, economic group, and instrument are separate concepts with separate
-- decisions. G-15: the same borrower does not imply the same instrument. G-09: no CIK here.
-- G-13: decisions use exactly MATCHED, PROBABLE, UNRESOLVED, REJECTED; ambiguous stays
-- UNRESOLVED. Identity rows hold identifiers only; every link is a versioned decision.
-- No resolution logic is implemented in this phase.

CREATE TABLE identity.legal_entity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creation_reason  text NOT NULL CHECK (btrim(creation_reason) <> ''),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE identity.legal_entity IS 'A legal entity. Names live in identity.legal_entity_alias; there is no CIK column.';

CREATE TABLE identity.legal_entity_alias (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legal_entity_id      uuid NOT NULL REFERENCES identity.legal_entity (id),
  alias_text           text NOT NULL CHECK (btrim(alias_text) <> ''),
  verification_state   text NOT NULL CHECK (verification_state IN ('UNVERIFIED', 'VERIFIED')),
  rule_version_id      bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id          bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id               bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id        bigint REFERENCES identity.legal_entity_alias (id),
  supersede_reason     text,
  recorded_at          timestamptz NOT NULL DEFAULT now()
);
SELECT ops.add_supersession('identity.legal_entity_alias', 'legal_entity_id', 'multi');

CREATE TABLE identity.economic_group (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_label    text NOT NULL CHECK (btrim(display_label) <> ''),
  creation_reason  text NOT NULL CHECK (btrim(creation_reason) <> ''),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE identity.economic_group IS 'Related legal entities. Never inferred from name similarity alone; membership is a decision.';

CREATE TABLE identity.instrument (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creation_reason  text NOT NULL CHECK (btrim(creation_reason) <> ''),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE identity.instrument IS 'A specific loan, tranche, or security. Attributes are evidenced assertions, not columns.';

CREATE TABLE identity.instrument_attribute_assertion (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instrument_id       uuid NOT NULL REFERENCES identity.instrument (id),
  field_code          text NOT NULL REFERENCES ref.field_definition (field_code),
  value_numeric       numeric,
  value_date          date,
  value_text          text,
  value_state         ref.value_state NOT NULL CHECK (value_state IN ('REPORTED', 'UNKNOWN', 'NOT_APPLICABLE')),
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id         bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id       bigint REFERENCES identity.instrument_attribute_assertion (id),
  supersede_reason    text,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(value_numeric, value_date, value_text) <= 1),
  CHECK ((value_state = 'REPORTED') = (num_nonnulls(value_numeric, value_date, value_text) = 1))
);
SELECT ops.add_supersession('identity.instrument_attribute_assertion', 'instrument_id,field_code', 'multi');

CREATE TABLE identity.position (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_id    bigint NOT NULL REFERENCES registry.registrant (id),
  creation_reason  text NOT NULL CHECK (btrim(creation_reason) <> ''),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE identity.position IS 'Continuity of one registrant''s holding over time. registrant_id is the holder (the BDC), never the borrower.';

-- ---------------------------------------------------------------------------
-- Match candidates: inputs to decisions only, with per-attribute comparisons and no score (G-06)
-- ---------------------------------------------------------------------------

CREATE TABLE resolution.match_candidate (
  id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_kind               text NOT NULL CHECK (candidate_kind IN ('LEGAL_ENTITY', 'ECONOMIC_GROUP', 'INSTRUMENT', 'POSITION')),
  borrower_name_observation_id bigint REFERENCES obs.borrower_name_observation (id),
  position_observation_id      bigint REFERENCES obs.position_observation (id),
  legal_entity_id              uuid REFERENCES identity.legal_entity (id),
  economic_group_id            uuid REFERENCES identity.economic_group (id),
  instrument_id                uuid REFERENCES identity.instrument (id),
  position_id                  uuid REFERENCES identity.position (id),
  rule_version_id              bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE candidate_kind
    WHEN 'LEGAL_ENTITY' THEN borrower_name_observation_id IS NOT NULL AND legal_entity_id IS NOT NULL
      AND num_nonnulls(position_observation_id, economic_group_id, instrument_id, position_id) = 0
    WHEN 'ECONOMIC_GROUP' THEN legal_entity_id IS NOT NULL AND economic_group_id IS NOT NULL
      AND num_nonnulls(borrower_name_observation_id, position_observation_id, instrument_id, position_id) = 0
    WHEN 'INSTRUMENT' THEN position_observation_id IS NOT NULL AND instrument_id IS NOT NULL
      AND num_nonnulls(borrower_name_observation_id, legal_entity_id, economic_group_id, position_id) = 0
    WHEN 'POSITION' THEN position_observation_id IS NOT NULL AND position_id IS NOT NULL
      AND num_nonnulls(borrower_name_observation_id, legal_entity_id, economic_group_id, instrument_id) = 0
  END)
);

CREATE TABLE resolution.match_candidate_comparison (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_candidate_id  bigint NOT NULL REFERENCES resolution.match_candidate (id),
  attribute_code      text NOT NULL CHECK (attribute_code ~ '^[A-Z][A-Z0-9_]*$'),
  outcome             ref.comparison_outcome NOT NULL,
  left_evidence_id    bigint REFERENCES evidence.evidence (id),
  right_evidence_id   bigint REFERENCES evidence.evidence (id),
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_candidate_id, attribute_code, rule_version_id)
);

-- ---------------------------------------------------------------------------
-- Decisions. Shared shape: subject, target (NULL allowed only for UNRESOLVED), state, method,
-- rationale, actor, rule version, evidence, supersession. One linear history per subject.
-- ---------------------------------------------------------------------------

CREATE TABLE resolution.entity_resolution_decision (
  id                            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  borrower_name_observation_id  bigint NOT NULL REFERENCES obs.borrower_name_observation (id),
  legal_entity_id               uuid REFERENCES identity.legal_entity (id),
  match_candidate_id            bigint REFERENCES resolution.match_candidate (id),
  state                         ref.resolution_state NOT NULL,
  method                        text NOT NULL CHECK (btrim(method) <> ''),
  rationale                     text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind                    ref.actor_kind NOT NULL,
  decided_by                    text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at                    timestamptz NOT NULL,
  rule_version_id               bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id                   bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                        bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id                 bigint REFERENCES resolution.entity_resolution_decision (id),
  supersede_reason              text,
  recorded_at                   timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'UNRESOLVED' OR legal_entity_id IS NOT NULL)
);
SELECT ops.add_supersession('resolution.entity_resolution_decision', 'borrower_name_observation_id', 'single_chain');

CREATE TABLE resolution.group_membership_decision (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legal_entity_id     uuid NOT NULL REFERENCES identity.legal_entity (id),
  economic_group_id   uuid NOT NULL REFERENCES identity.economic_group (id),
  effective_from      date,
  effective_to        date,
  match_candidate_id  bigint REFERENCES resolution.match_candidate (id),
  state               ref.resolution_state NOT NULL,
  method              text NOT NULL CHECK (btrim(method) <> ''),
  rationale           text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind          ref.actor_kind NOT NULL,
  decided_by          text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at          timestamptz NOT NULL,
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id         bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id       bigint REFERENCES resolution.group_membership_decision (id),
  supersede_reason    text,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);
SELECT ops.add_supersession('resolution.group_membership_decision', 'legal_entity_id,economic_group_id', 'single_chain');

CREATE TABLE resolution.instrument_resolution_decision (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id         bigint REFERENCES obs.position_observation (id),
  position_observation_group_id   bigint REFERENCES obs.position_observation_group (id),
  instrument_id                   uuid REFERENCES identity.instrument (id),
  match_candidate_id              bigint REFERENCES resolution.match_candidate (id),
  state                           ref.resolution_state NOT NULL,
  method                          text NOT NULL CHECK (btrim(method) <> ''),
  rationale                       text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind                      ref.actor_kind NOT NULL,
  decided_by                      text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at                      timestamptz NOT NULL,
  rule_version_id                 bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id                     bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                          bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id                   bigint REFERENCES resolution.instrument_resolution_decision (id),
  supersede_reason                text,
  recorded_at                     timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(position_observation_id, position_observation_group_id) = 1),
  CHECK (state = 'UNRESOLVED' OR instrument_id IS NOT NULL)
);
SELECT ops.add_supersession('resolution.instrument_resolution_decision', 'position_observation_id,position_observation_group_id', 'single_chain');

CREATE TABLE resolution.position_continuity_decision (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id  bigint NOT NULL REFERENCES obs.position_observation (id),
  position_id              uuid REFERENCES identity.position (id),
  match_candidate_id       bigint REFERENCES resolution.match_candidate (id),
  state                    ref.resolution_state NOT NULL,
  method                   text NOT NULL CHECK (btrim(method) <> ''),
  rationale                text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind               ref.actor_kind NOT NULL,
  decided_by               text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at               timestamptz NOT NULL,
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  evidence_id              bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id            bigint REFERENCES resolution.position_continuity_decision (id),
  supersede_reason         text,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'UNRESOLVED' OR position_id IS NOT NULL)
);
SELECT ops.add_supersession('resolution.position_continuity_decision', 'position_observation_id', 'single_chain');

-- A position belongs to one registrant: continuity may only link observations filed by it.
CREATE FUNCTION resolution.check_position_continuity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM identity.position pos
    JOIN obs.position_observation po ON po.id = NEW.position_observation_id
    JOIN registry.filing_registrant_link l ON l.filing_id = po.filing_id AND l.registrant_id = pos.registrant_id
    WHERE pos.id = NEW.position_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'position continuity requires the observation filing to be linked to the position registrant';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_position_continuity BEFORE INSERT ON resolution.position_continuity_decision
  FOR EACH ROW EXECUTE FUNCTION resolution.check_position_continuity();

SELECT ops.apply_append_only_to_all();
