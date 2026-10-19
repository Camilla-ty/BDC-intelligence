-- 0063 external identifiers for portfolio legal entities (ADR 0018).
-- Canonical Borrower ID remains identity.legal_entity.id.
-- registry.registrant.cik is a filer identifier and is not written here.
-- Append-only assertions; v1 stores raw_value exactly and normalized_value NULL.
-- Does not require 0060–0062 objects. Creates resolution_writer only when absent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolution_writer') THEN
    CREATE ROLE resolution_writer NOLOGIN;
    EXECUTE $c$COMMENT ON ROLE resolution_writer IS
      'Human identifier writes via SECURITY DEFINER helpers only. Not granted to a login role by this migration.'$c$;
  END IF;
END
$$;

CREATE TABLE ref.legal_entity_identifier_scheme (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  description  text NOT NULL CHECK (btrim(description) <> '')
);
COMMENT ON TABLE ref.legal_entity_identifier_scheme IS
  'Controlled schemes for portfolio legal-entity external identifiers. Not a borrower key.';

INSERT INTO ref.legal_entity_identifier_scheme (code, description) VALUES
  ('CIK', 'SEC Central Index Key as asserted for a portfolio legal entity, distinct from registry.registrant.cik'),
  ('LEI', 'Legal Entity Identifier');

INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES
(
  'identity.legal_entity_identifier.pipeline_unverified',
  'EXTRACTION',
  '1',
  encode(sha256(convert_to(
    'identity.legal_entity_identifier.pipeline_unverified v1: SYSTEM_RULE UNVERIFIED; evidence_id required; raw_value unchanged; normalized_value NULL',
    'UTF8')), 'hex'),
  'docs/adr/0018-legal-entity-external-identifiers.md',
  'Pipeline-created external identifier assertions remain unverified',
  'migration 0063_legal_entity_external_identifiers'
),
(
  'identity.legal_entity_identifier.human_review',
  'REVIEW_PROCEDURE',
  '1',
  encode(sha256(convert_to(
    'identity.legal_entity_identifier.human_review v1: HUMAN_REVIEW verify or withdraw; evidence or complete citation; raw_value unchanged; normalized_value NULL',
    'UTF8')), 'hex'),
  'docs/adr/0018-legal-entity-external-identifiers.md',
  'Human-reviewed external identifier verification and withdrawal',
  'migration 0063_legal_entity_external_identifiers'
);

CREATE TABLE identity.legal_entity_identifier (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legal_entity_id            uuid NOT NULL REFERENCES identity.legal_entity (id),
  scheme                     text NOT NULL REFERENCES ref.legal_entity_identifier_scheme (code),
  relationship_role          text NOT NULL
    CHECK (relationship_role IN ('OWN', 'PARENT', 'AFFILIATE', 'UNKNOWN')),
  raw_value                  text NOT NULL CHECK (btrim(raw_value) <> ''),
  normalized_value           text,
  verification_state         text NOT NULL
    CHECK (verification_state IN ('UNVERIFIED', 'VERIFIED')),
  actor_kind                 ref.actor_kind NOT NULL,
  decided_by                 text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at                 timestamptz NOT NULL,
  rule_version_id            bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                     bigint NOT NULL REFERENCES ops.run (id),
  evidence_id                bigint REFERENCES evidence.evidence (id),
  researcher_citation_url    text,
  researcher_citation_title  text,
  researcher_citation_excerpt text,
  supersedes_id              bigint REFERENCES identity.legal_entity_identifier (id),
  supersede_reason           text,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_value IS NULL),
  CHECK (verification_state <> 'VERIFIED' OR actor_kind = 'HUMAN_REVIEW'),
  CHECK (
    (actor_kind = 'SYSTEM_RULE' AND verification_state = 'UNVERIFIED' AND evidence_id IS NOT NULL)
    OR actor_kind = 'HUMAN_REVIEW'
  ),
  CHECK (
    evidence_id IS NOT NULL
    OR (
      researcher_citation_url IS NOT NULL
      AND researcher_citation_url ~ '^https://[^[:space:]]+$'
      AND researcher_citation_title IS NOT NULL
      AND btrim(researcher_citation_title) <> ''
      AND researcher_citation_excerpt IS NOT NULL
      AND btrim(researcher_citation_excerpt) <> ''
    )
  ),
  CHECK (
    (researcher_citation_url IS NULL) = (researcher_citation_title IS NULL)
    AND (researcher_citation_url IS NULL) = (researcher_citation_excerpt IS NULL)
  )
);
COMMENT ON TABLE identity.legal_entity_identifier IS
  'Append-only external identifier assertions for a portfolio legal entity. Does not replace identity.legal_entity.id and does not store a filer CIK as a borrower key.';
COMMENT ON COLUMN identity.legal_entity_identifier.raw_value IS
  'Identifier text exactly as retrieved. v1 does not rewrite it.';
COMMENT ON COLUMN identity.legal_entity_identifier.normalized_value IS
  'Reserved. v1 writers and the table CHECK keep this NULL.';
COMMENT ON COLUMN identity.legal_entity_identifier.relationship_role IS
  'OWN, PARENT, AFFILIATE, or UNKNOWN. FILER is not a v1 role.';

SELECT ops.add_supersession(
  'identity.legal_entity_identifier',
  'legal_entity_id,scheme,relationship_role,raw_value',
  'single_chain'
);

CREATE VIEW identity.current_legal_entity_identifier AS
SELECT i.*
FROM identity.legal_entity_identifier i
WHERE NOT EXISTS (
  SELECT 1 FROM identity.legal_entity_identifier s WHERE s.supersedes_id = i.id
);
COMMENT ON VIEW identity.current_legal_entity_identifier IS
  'Non-superseded identifier tips. One tip per (legal_entity_id, scheme, relationship_role, raw_value).';

CREATE VIEW identity.ambiguous_verified_own_identifier AS
SELECT
  legal_entity_id,
  scheme,
  count(*)::bigint AS verified_own_tip_count
FROM identity.current_legal_entity_identifier
WHERE relationship_role = 'OWN'
  AND verification_state = 'VERIFIED'
GROUP BY legal_entity_id, scheme
HAVING count(*) > 1;
COMMENT ON VIEW identity.ambiguous_verified_own_identifier IS
  'Fail closed: more than one current VERIFIED OWN tip for the same legal entity and scheme, including different raw values. Consumers must not pick a winner or emit MATCHED.';

CREATE FUNCTION identity.assert_identifier_pipeline_writer() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'bdc_pipeline_writer'
     AND NOT pg_has_role(session_user, 'bdc_pipeline_writer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'unverified legal-entity identifier writes require bdc_pipeline_writer';
  END IF;
END
$$;

CREATE FUNCTION identity.assert_identifier_resolution_writer() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'resolution_writer'
     AND NOT pg_has_role(session_user, 'resolution_writer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'verified legal-entity identifier writes require resolution_writer';
  END IF;
END
$$;

CREATE FUNCTION identity.pipeline_unverified_identifier_rule_version_id() RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, ops
AS $$
  SELECT id
  FROM ops.rule_version
  WHERE rule_code = 'identity.legal_entity_identifier.pipeline_unverified'
  ORDER BY id DESC
  LIMIT 1
$$;

CREATE FUNCTION identity.human_review_identifier_rule_version_id() RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, ops
AS $$
  SELECT id
  FROM ops.rule_version
  WHERE rule_code = 'identity.legal_entity_identifier.human_review'
  ORDER BY id DESC
  LIMIT 1
$$;

CREATE FUNCTION identity.identifier_citation_ok(
  p_evidence_id bigint,
  p_url text,
  p_title text,
  p_excerpt text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    (p_url IS NULL) = (p_title IS NULL)
    AND (p_url IS NULL) = (p_excerpt IS NULL)
    AND (
      p_evidence_id IS NOT NULL
      OR (
        p_url IS NOT NULL
        AND p_url ~ '^https://[^[:space:]]+$'
        AND p_title IS NOT NULL
        AND btrim(p_title) <> ''
        AND p_excerpt IS NOT NULL
        AND btrim(p_excerpt) <> ''
      )
    )
$$;

CREATE FUNCTION identity.begin_legal_entity_identifier_run(p_parameters jsonb) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ops, identity
AS $$
DECLARE
  new_run bigint;
BEGIN
  PERFORM identity.assert_identifier_resolution_writer();
  INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
  VALUES (
    'LEGAL_ENTITY_IDENTIFIER',
    'identity.legal_entity_identifier.human_review.v1',
    coalesce(p_parameters, '{}'::jsonb),
    now()
  )
  RETURNING id INTO new_run;
  INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
  VALUES (new_run, 'SUCCEEDED', now(), jsonb_build_object('assertions', 1));
  RETURN new_run;
END
$$;

CREATE FUNCTION identity.record_unverified_legal_entity_identifier(
  p_legal_entity_id uuid,
  p_scheme text,
  p_relationship_role text,
  p_raw_value text,
  p_evidence_id bigint,
  p_run_id bigint,
  p_expected_current_id bigint,
  p_supersede_reason text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, ops, evidence, ref
AS $$
DECLARE
  cur_id bigint;
  rule_id bigint;
  new_id bigint;
  lock_key text;
BEGIN
  PERFORM identity.assert_identifier_pipeline_writer();
  IF p_legal_entity_id IS NULL OR p_scheme IS NULL OR p_relationship_role IS NULL OR p_raw_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'unverified identifier requires legal entity, scheme, role, and raw value';
  END IF;
  IF p_relationship_role NOT IN ('OWN', 'PARENT', 'AFFILIATE', 'UNKNOWN') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier relationship_role must be OWN, PARENT, AFFILIATE, or UNKNOWN';
  END IF;
  IF coalesce(btrim(p_raw_value), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier raw_value must contain a non-space character';
  END IF;
  IF p_evidence_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'pipeline identifier assertions require evidence_id';
  END IF;
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'pipeline identifier assertions require run_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_legal_entity_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'legal entity not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ref.legal_entity_identifier_scheme WHERE code = p_scheme) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'unknown legal-entity identifier scheme';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence.evidence WHERE id = p_evidence_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ops.run WHERE id = p_run_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'pipeline run not found';
  END IF;

  lock_key := p_legal_entity_id::text || '|' || p_scheme || '|' || p_relationship_role || '|' || p_raw_value;
  PERFORM pg_advisory_xact_lock(872018, hashtext(lock_key));

  SELECT c.id INTO cur_id
  FROM identity.current_legal_entity_identifier c
  WHERE c.legal_entity_id = p_legal_entity_id
    AND c.scheme = p_scheme
    AND c.relationship_role = p_relationship_role
    AND c.raw_value = p_raw_value;

  IF cur_id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'identifier write is stale: current head does not match expected id';
  END IF;
  IF cur_id IS NOT NULL AND coalesce(btrim(p_supersede_reason), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'superseding an identifier requires supersede_reason';
  END IF;
  IF cur_id IS NULL AND p_supersede_reason IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS1',
      MESSAGE = 'supersede_reason given without a current identifier tip';
  END IF;

  rule_id := identity.pipeline_unverified_identifier_rule_version_id();
  IF rule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'missing pipeline identifier rule_version';
  END IF;

  INSERT INTO identity.legal_entity_identifier (
      legal_entity_id, scheme, relationship_role, raw_value, normalized_value,
      verification_state, actor_kind, decided_by, decided_at, rule_version_id, run_id,
      evidence_id, researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      supersedes_id, supersede_reason)
  VALUES (
      p_legal_entity_id, p_scheme, p_relationship_role, p_raw_value, NULL,
      'UNVERIFIED', 'SYSTEM_RULE', 'pipeline:legal_entity_identifier', now(), rule_id, p_run_id,
      p_evidence_id, NULL, NULL, NULL,
      cur_id, CASE WHEN cur_id IS NULL THEN NULL ELSE p_supersede_reason END)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION identity.verify_legal_entity_identifier(
  p_legal_entity_id uuid,
  p_scheme text,
  p_relationship_role text,
  p_raw_value text,
  p_decided_by text,
  p_evidence_id bigint,
  p_researcher_citation_url text,
  p_researcher_citation_title text,
  p_researcher_citation_excerpt text,
  p_expected_current_id bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, ops, evidence, ref
AS $$
DECLARE
  cur_id bigint;
  rule_id bigint;
  run_id bigint;
  new_id bigint;
  lock_key text;
BEGIN
  PERFORM identity.assert_identifier_resolution_writer();
  IF p_legal_entity_id IS NULL OR p_scheme IS NULL OR p_relationship_role IS NULL OR p_raw_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'verified identifier requires legal entity, scheme, role, and raw value';
  END IF;
  IF p_relationship_role NOT IN ('OWN', 'PARENT', 'AFFILIATE', 'UNKNOWN') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier relationship_role must be OWN, PARENT, AFFILIATE, or UNKNOWN';
  END IF;
  IF coalesce(btrim(p_raw_value), '') = '' OR coalesce(btrim(p_decided_by), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'verified identifier requires raw_value and decided_by';
  END IF;
  IF NOT identity.identifier_citation_ok(
       p_evidence_id, p_researcher_citation_url, p_researcher_citation_title, p_researcher_citation_excerpt) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'verified identifier requires evidence_id or a complete citation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_legal_entity_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'legal entity not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ref.legal_entity_identifier_scheme WHERE code = p_scheme) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'unknown legal-entity identifier scheme';
  END IF;
  IF p_evidence_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence.evidence WHERE id = p_evidence_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence not found';
  END IF;

  lock_key := p_legal_entity_id::text || '|' || p_scheme || '|' || p_relationship_role || '|' || p_raw_value;
  PERFORM pg_advisory_xact_lock(872018, hashtext(lock_key));

  SELECT c.id INTO cur_id
  FROM identity.current_legal_entity_identifier c
  WHERE c.legal_entity_id = p_legal_entity_id
    AND c.scheme = p_scheme
    AND c.relationship_role = p_relationship_role
    AND c.raw_value = p_raw_value;

  IF cur_id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'identifier verification is stale: current head does not match expected id';
  END IF;

  rule_id := identity.human_review_identifier_rule_version_id();
  IF rule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'missing human identifier rule_version';
  END IF;
  run_id := identity.begin_legal_entity_identifier_run(jsonb_build_object(
    'action', 'verify',
    'legal_entity_id', p_legal_entity_id,
    'scheme', p_scheme,
    'relationship_role', p_relationship_role
  ));

  INSERT INTO identity.legal_entity_identifier (
      legal_entity_id, scheme, relationship_role, raw_value, normalized_value,
      verification_state, actor_kind, decided_by, decided_at, rule_version_id, run_id,
      evidence_id, researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      supersedes_id, supersede_reason)
  VALUES (
      p_legal_entity_id, p_scheme, p_relationship_role, p_raw_value, NULL,
      'VERIFIED', 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id,
      p_evidence_id, p_researcher_citation_url, p_researcher_citation_title, p_researcher_citation_excerpt,
      cur_id, CASE WHEN cur_id IS NULL THEN NULL ELSE 'verify legal entity identifier' END)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION identity.withdraw_legal_entity_identifier(
  p_legal_entity_id uuid,
  p_scheme text,
  p_relationship_role text,
  p_raw_value text,
  p_decided_by text,
  p_supersede_reason text,
  p_evidence_id bigint,
  p_researcher_citation_url text,
  p_researcher_citation_title text,
  p_researcher_citation_excerpt text,
  p_expected_current_id bigint,
  p_copy_evidence_from_tip boolean
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, ops, evidence, ref
AS $$
DECLARE
  cur identity.legal_entity_identifier%ROWTYPE;
  use_evidence bigint;
  use_url text;
  use_title text;
  use_excerpt text;
  rule_id bigint;
  run_id bigint;
  new_id bigint;
  lock_key text;
BEGIN
  PERFORM identity.assert_identifier_resolution_writer();
  IF coalesce(btrim(p_decided_by), '') = '' OR coalesce(btrim(p_supersede_reason), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier withdrawal requires decided_by and supersede_reason';
  END IF;
  IF p_relationship_role NOT IN ('OWN', 'PARENT', 'AFFILIATE', 'UNKNOWN') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier relationship_role must be OWN, PARENT, AFFILIATE, or UNKNOWN';
  END IF;
  IF p_expected_current_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier withdrawal requires the current tip id';
  END IF;

  lock_key := p_legal_entity_id::text || '|' || p_scheme || '|' || p_relationship_role || '|' || p_raw_value;
  PERFORM pg_advisory_xact_lock(872018, hashtext(lock_key));

  SELECT * INTO cur
  FROM identity.current_legal_entity_identifier c
  WHERE c.legal_entity_id = p_legal_entity_id
    AND c.scheme = p_scheme
    AND c.relationship_role = p_relationship_role
    AND c.raw_value = p_raw_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no current identifier tip to withdraw';
  END IF;
  IF cur.id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'identifier withdrawal is stale: current head does not match expected id';
  END IF;

  IF coalesce(p_copy_evidence_from_tip, false) THEN
    IF p_evidence_id IS NOT NULL
       OR p_researcher_citation_url IS NOT NULL
       OR p_researcher_citation_title IS NOT NULL
       OR p_researcher_citation_excerpt IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'withdrawal copies tip evidence or accepts new evidence, not both';
    END IF;
    use_evidence := cur.evidence_id;
    use_url := cur.researcher_citation_url;
    use_title := cur.researcher_citation_title;
    use_excerpt := cur.researcher_citation_excerpt;
  ELSE
    use_evidence := p_evidence_id;
    use_url := p_researcher_citation_url;
    use_title := p_researcher_citation_title;
    use_excerpt := p_researcher_citation_excerpt;
  END IF;
  IF NOT identity.identifier_citation_ok(use_evidence, use_url, use_title, use_excerpt) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'identifier withdrawal requires evidence_id or a complete citation';
  END IF;
  IF use_evidence IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence.evidence WHERE id = use_evidence) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence not found';
  END IF;

  rule_id := identity.human_review_identifier_rule_version_id();
  IF rule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'missing human identifier rule_version';
  END IF;
  run_id := identity.begin_legal_entity_identifier_run(jsonb_build_object(
    'action', 'withdraw',
    'legal_entity_id', p_legal_entity_id,
    'scheme', p_scheme,
    'relationship_role', p_relationship_role,
    'supersedes_id', cur.id
  ));

  INSERT INTO identity.legal_entity_identifier (
      legal_entity_id, scheme, relationship_role, raw_value, normalized_value,
      verification_state, actor_kind, decided_by, decided_at, rule_version_id, run_id,
      evidence_id, researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      supersedes_id, supersede_reason)
  VALUES (
      p_legal_entity_id, p_scheme, p_relationship_role, cur.raw_value, NULL,
      'UNVERIFIED', 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id,
      use_evidence, use_url, use_title, use_excerpt,
      cur.id, p_supersede_reason)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

REVOKE ALL ON FUNCTION identity.assert_identifier_pipeline_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.assert_identifier_resolution_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.pipeline_unverified_identifier_rule_version_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.human_review_identifier_rule_version_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.identifier_citation_ok(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.begin_legal_entity_identifier_run(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.record_unverified_legal_entity_identifier(uuid, text, text, text, bigint, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.verify_legal_entity_identifier(uuid, text, text, text, text, bigint, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.withdraw_legal_entity_identifier(uuid, text, text, text, text, text, bigint, text, text, text, bigint, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION identity.record_unverified_legal_entity_identifier(uuid, text, text, text, bigint, bigint, bigint, text)
  TO bdc_pipeline_writer;
GRANT EXECUTE ON FUNCTION identity.begin_legal_entity_identifier_run(jsonb) TO resolution_writer;
GRANT EXECUTE ON FUNCTION identity.verify_legal_entity_identifier(uuid, text, text, text, text, bigint, text, text, text, bigint)
  TO resolution_writer;
GRANT EXECUTE ON FUNCTION identity.withdraw_legal_entity_identifier(uuid, text, text, text, text, text, bigint, text, text, text, bigint, boolean)
  TO resolution_writer;

GRANT USAGE ON SCHEMA identity TO resolution_writer, admin_reader;
GRANT USAGE ON SCHEMA ref TO resolution_writer, admin_reader;
GRANT USAGE ON SCHEMA ops TO resolution_writer;
GRANT USAGE ON SCHEMA evidence TO resolution_writer;

REVOKE ALL ON TABLE identity.legal_entity_identifier FROM PUBLIC;
REVOKE ALL ON TABLE identity.current_legal_entity_identifier FROM PUBLIC;
REVOKE ALL ON TABLE identity.ambiguous_verified_own_identifier FROM PUBLIC;
REVOKE ALL ON TABLE ref.legal_entity_identifier_scheme FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON identity.legal_entity_identifier
  FROM bdc_pipeline_writer, resolution_writer, admin_reader, bdc_reader;
REVOKE ALL ON SEQUENCE identity.legal_entity_identifier_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE identity.legal_entity_identifier_id_seq
  FROM bdc_pipeline_writer, resolution_writer, admin_reader, bdc_reader;

GRANT SELECT ON identity.legal_entity_identifier TO bdc_pipeline_writer, resolution_writer, admin_reader;
GRANT SELECT ON identity.current_legal_entity_identifier
  TO bdc_pipeline_writer, resolution_writer, admin_reader, bdc_reader;
GRANT SELECT ON identity.ambiguous_verified_own_identifier
  TO bdc_pipeline_writer, resolution_writer, admin_reader, bdc_reader;
GRANT SELECT ON ref.legal_entity_identifier_scheme TO bdc_pipeline_writer, resolution_writer, admin_reader;

SELECT ops.apply_append_only_to_all();
