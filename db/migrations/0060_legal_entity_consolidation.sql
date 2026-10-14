-- 0060 legal-entity consolidation (canonical Borrower ID).
-- Append-only HUMAN_REVIEW decisions map a source legal_entity UUID to a survivor.
-- Pending proposals are PROBABLE and never affect canonical reads. Approved mappings
-- are MATCHED. Reversal supersedes with REJECTED (no target). G-10, G-13, G-14.
-- Does not merge instruments, economic groups, positions, or rewrite observations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolution_writer') THEN
    CREATE ROLE resolution_writer NOLOGIN;
  END IF;
END
$$;
COMMENT ON ROLE resolution_writer IS
  'INSERT into resolution.legal_entity_consolidation_decision via SECURITY DEFINER helpers only. Not granted to a login role by this migration.';

INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (
  'resolution.legal_entity_consolidation',
  'RESOLUTION',
  '1',
  encode(sha256(convert_to(
    'resolution.legal_entity_consolidation v1: Admin-reviewed append-only from→to mapping; PROBABLE proposal; MATCHED approved; REJECTED reversal; pending never canonical',
    'UTF8')), 'hex'),
  'docs/adr/0017-legal-entity-consolidation.md',
  'Human-reviewed legal-entity consolidation for one canonical Borrower ID per company',
  'migration 0060_legal_entity_consolidation'
);

CREATE TABLE resolution.legal_entity_consolidation_decision (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_legal_entity_id     uuid NOT NULL REFERENCES identity.legal_entity (id),
  to_legal_entity_id       uuid REFERENCES identity.legal_entity (id),
  state                    ref.resolution_state NOT NULL,
  method                   text NOT NULL CHECK (btrim(method) <> ''),
  rationale                text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind               ref.actor_kind NOT NULL CHECK (actor_kind = 'HUMAN_REVIEW'),
  decided_by               text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at               timestamptz NOT NULL,
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  evidence_id              bigint REFERENCES evidence.evidence (id),
  researcher_citation_url  text,
  researcher_citation_title text,
  researcher_citation_excerpt text,
  review_candidate_id      bigint REFERENCES review.candidate (id),
  supersedes_id            bigint REFERENCES resolution.legal_entity_consolidation_decision (id),
  supersede_reason         text,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (from_legal_entity_id IS DISTINCT FROM to_legal_entity_id),
  CHECK (
    (state = 'PROBABLE' AND method = 'CONSOLIDATION_PROPOSED' AND to_legal_entity_id IS NOT NULL)
    OR (state = 'MATCHED' AND method = 'CONSOLIDATION_APPROVED' AND to_legal_entity_id IS NOT NULL)
    OR (state = 'REJECTED' AND method = 'CONSOLIDATION_REVERSED' AND to_legal_entity_id IS NULL)
  ),
  CHECK (
    evidence_id IS NOT NULL
    OR (
      researcher_citation_url IS NOT NULL
      AND researcher_citation_url ~ '^https://[^[:space:]]+$'
      AND researcher_citation_excerpt IS NOT NULL
      AND btrim(researcher_citation_excerpt) <> ''
      AND researcher_citation_title IS NOT NULL
      AND btrim(researcher_citation_title) <> ''
    )
  ),
  CHECK (
    (researcher_citation_url IS NULL)
    = (researcher_citation_title IS NULL)
    AND (researcher_citation_url IS NULL) = (researcher_citation_excerpt IS NULL)
  )
);
COMMENT ON TABLE resolution.legal_entity_consolidation_decision IS
  'Append-only legal-entity consolidation. PROBABLE = pending proposal; MATCHED = approved mapping used by canonical resolution; REJECTED = reversal. Never deletes legal_entity rows.';
COMMENT ON COLUMN resolution.legal_entity_consolidation_decision.evidence_id IS
  'Optional structured pipeline evidence.evidence row. Distinct from researcher_citation_* which is never promoted to verified SEC evidence.';
COMMENT ON COLUMN resolution.legal_entity_consolidation_decision.researcher_citation_url IS
  'Researcher-provided citation URL. Admissible for review; not structured SEC evidence.';

SELECT ops.add_supersession(
  'resolution.legal_entity_consolidation_decision',
  'from_legal_entity_id',
  'single_chain'
);

CREATE VIEW resolution.current_legal_entity_consolidation AS
SELECT d.*
FROM resolution.legal_entity_consolidation_decision d
WHERE NOT EXISTS (
  SELECT 1 FROM resolution.legal_entity_consolidation_decision s WHERE s.supersedes_id = d.id
);
COMMENT ON VIEW resolution.current_legal_entity_consolidation IS
  'Current consolidation head per from_legal_entity_id (append-only tip). Canonical redirect semantics are defined by resolution.canonical_legal_entity.';

CREATE FUNCTION resolution.canonical_legal_entity(p_legal_entity_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, resolution, identity
AS $$
DECLARE
  cur uuid := p_legal_entity_id;
  nxt uuid;
  depth integer := 0;
  seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_legal_entity_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_legal_entity_id) THEN
    RETURN NULL;
  END IF;

  LOOP
    IF cur = ANY (seen) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI2',
        MESSAGE = 'canonical_legal_entity: consolidation cycle detected';
    END IF;
    depth := depth + 1;
    IF depth > 64 THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI2',
        MESSAGE = 'canonical_legal_entity: consolidation chain too deep';
    END IF;
    seen := seen || cur;

    SELECT c.to_legal_entity_id
      INTO nxt
    FROM resolution.current_legal_entity_consolidation c
    WHERE c.from_legal_entity_id = cur
      AND c.state = 'MATCHED'
      AND c.to_legal_entity_id IS NOT NULL;

    IF nxt IS NULL THEN
      RETURN cur;
    END IF;
    cur := nxt;
  END LOOP;
END
$$;
COMMENT ON FUNCTION resolution.canonical_legal_entity(uuid) IS
  'Follows approved (MATCHED) consolidation heads to the terminal legal_entity UUID. Pending PROBABLE proposals are ignored. Missing entities return NULL. Cycles raise BDCI2.';

CREATE FUNCTION resolution.legal_entities_with_canonical(p_canonical_id uuid)
RETURNS TABLE (legal_entity_id uuid)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, resolution, identity
AS $$
  SELECT le.id
  FROM identity.legal_entity le
  WHERE p_canonical_id IS NOT NULL
    AND resolution.canonical_legal_entity(le.id) IS NOT DISTINCT FROM p_canonical_id
$$;
COMMENT ON FUNCTION resolution.legal_entities_with_canonical(uuid) IS
  'Every legal_entity UUID whose approved canonical identity equals p_canonical_id, including the canonical UUID itself.';

CREATE FUNCTION resolution.check_legal_entity_consolidation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, resolution, identity
AS $$
DECLARE
  walk uuid;
  depth integer := 0;
  seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NEW.to_legal_entity_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = NEW.to_legal_entity_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'consolidation to_legal_entity_id must reference identity.legal_entity';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = NEW.from_legal_entity_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'consolidation from_legal_entity_id must reference identity.legal_entity';
  END IF;

  -- Cycle check for an approved edge: following current MATCHED edges from NEW.to
  -- must never reach NEW.from. Include NEW as a provisional edge.
  IF NEW.state = 'MATCHED' AND NEW.to_legal_entity_id IS NOT NULL THEN
    walk := NEW.to_legal_entity_id;
    LOOP
      IF walk = NEW.from_legal_entity_id THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval would create a cycle';
      END IF;
      IF walk = ANY (seen) THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval: existing cycle in MATCHED chain';
      END IF;
      depth := depth + 1;
      IF depth > 64 THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval: MATCHED chain too deep';
      END IF;
      seen := seen || walk;
      SELECT c.to_legal_entity_id INTO walk
      FROM resolution.current_legal_entity_consolidation c
      WHERE c.from_legal_entity_id = walk
        AND c.state = 'MATCHED'
        AND c.to_legal_entity_id IS NOT NULL
        AND (NEW.supersedes_id IS NULL OR c.id IS DISTINCT FROM NEW.supersedes_id);
      EXIT WHEN walk IS NULL;
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_legal_entity_consolidation
  BEFORE INSERT ON resolution.legal_entity_consolidation_decision
  FOR EACH ROW EXECUTE FUNCTION resolution.check_legal_entity_consolidation();

CREATE FUNCTION resolution.assert_consolidation_writer() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'resolution_writer'
     AND NOT pg_has_role(session_user, 'resolution_writer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'legal-entity consolidation writes require resolution_writer';
  END IF;
END
$$;

CREATE FUNCTION resolution.consolidation_rule_version_id() RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, ops
AS $$
  SELECT id
  FROM ops.rule_version
  WHERE rule_code = 'resolution.legal_entity_consolidation'
  ORDER BY id DESC
  LIMIT 1
$$;

CREATE FUNCTION resolution.begin_consolidation_run(p_parameters jsonb) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ops, resolution
AS $$
DECLARE
  new_run bigint;
BEGIN
  PERFORM resolution.assert_consolidation_writer();
  INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
  VALUES (
    'LEGAL_ENTITY_CONSOLIDATION',
    'resolution.legal_entity_consolidation.v1',
    coalesce(p_parameters, '{}'::jsonb),
    now()
  )
  RETURNING id INTO new_run;
  INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
  VALUES (new_run, 'SUCCEEDED', now(), jsonb_build_object('decisions', 1));
  RETURN new_run;
END
$$;

CREATE FUNCTION resolution.propose_legal_entity_consolidation(
  p_from_legal_entity_id uuid,
  p_to_legal_entity_id uuid,
  p_rationale text,
  p_decided_by text,
  p_evidence_id bigint,
  p_researcher_citation_url text,
  p_researcher_citation_title text,
  p_researcher_citation_excerpt text,
  p_expected_current_id bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, resolution, identity, ops, evidence
AS $$
DECLARE
  cur_id bigint;
  cur_state ref.resolution_state;
  run_id bigint;
  rule_id bigint;
  new_id bigint;
BEGIN
  PERFORM resolution.assert_consolidation_writer();
  IF p_from_legal_entity_id IS NULL OR p_to_legal_entity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'consolidation proposal requires from and to legal entity ids';
  END IF;
  IF p_from_legal_entity_id = p_to_legal_entity_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'self-consolidation is rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_from_legal_entity_id)
     OR NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_to_legal_entity_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'consolidation proposal: legal entity not found';
  END IF;
  IF coalesce(btrim(p_rationale), '') = '' OR coalesce(btrim(p_decided_by), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'consolidation proposal requires rationale and decided_by';
  END IF;

  SELECT c.id, c.state INTO cur_id, cur_state
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = p_from_legal_entity_id;

  IF cur_id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'consolidation proposal is stale: current head changed';
  END IF;
  IF cur_id IS NOT NULL AND cur_state = 'PROBABLE' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'a pending consolidation proposal already exists for this source entity';
  END IF;

  -- Approving would cycle if to already canonicalizes into from.
  IF resolution.canonical_legal_entity(p_to_legal_entity_id) IS NOT DISTINCT FROM p_from_legal_entity_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI2',
      MESSAGE = 'consolidation proposal would create a cycle when approved';
  END IF;

  rule_id := resolution.consolidation_rule_version_id();
  IF rule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'missing consolidation rule_version';
  END IF;
  run_id := resolution.begin_consolidation_run(jsonb_build_object(
    'action', 'propose',
    'from', p_from_legal_entity_id,
    'to', p_to_legal_entity_id
  ));

  INSERT INTO resolution.legal_entity_consolidation_decision (
      from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id, evidence_id,
      researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      supersedes_id, supersede_reason)
  VALUES (
      p_from_legal_entity_id, p_to_legal_entity_id, 'PROBABLE', 'CONSOLIDATION_PROPOSED',
      p_rationale, 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id, p_evidence_id,
      p_researcher_citation_url, p_researcher_citation_title, p_researcher_citation_excerpt,
      cur_id,
      CASE WHEN cur_id IS NULL THEN NULL ELSE 'new consolidation proposal' END)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION resolution.approve_legal_entity_consolidation(
  p_proposal_id bigint,
  p_decided_by text,
  p_rationale text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, resolution, identity, ops, evidence
AS $$
DECLARE
  prop resolution.legal_entity_consolidation_decision%ROWTYPE;
  head_id bigint;
  run_id bigint;
  rule_id bigint;
  new_id bigint;
BEGIN
  PERFORM resolution.assert_consolidation_writer();
  IF coalesce(btrim(p_decided_by), '') = '' OR coalesce(btrim(p_rationale), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'consolidation approval requires decided_by and rationale';
  END IF;

  SELECT * INTO prop
  FROM resolution.legal_entity_consolidation_decision
  WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'consolidation proposal not found';
  END IF;
  IF prop.state IS DISTINCT FROM 'PROBABLE' OR prop.method IS DISTINCT FROM 'CONSOLIDATION_PROPOSED' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'only a pending PROBABLE proposal can be approved';
  END IF;

  SELECT c.id INTO head_id
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = prop.from_legal_entity_id;
  IF head_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'consolidation approval is stale: proposal is not the current head';
  END IF;

  IF resolution.canonical_legal_entity(prop.to_legal_entity_id)
       IS NOT DISTINCT FROM prop.from_legal_entity_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI2', MESSAGE = 'consolidation approval would create a cycle';
  END IF;

  PERFORM pg_advisory_xact_lock(872014, hashtext(prop.from_legal_entity_id::text));

  -- Re-read head under lock.
  SELECT c.id INTO head_id
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = prop.from_legal_entity_id;
  IF head_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'consolidation approval is stale after lock';
  END IF;

  rule_id := resolution.consolidation_rule_version_id();
  run_id := resolution.begin_consolidation_run(jsonb_build_object(
    'action', 'approve',
    'proposal_id', p_proposal_id,
    'from', prop.from_legal_entity_id,
    'to', prop.to_legal_entity_id
  ));

  INSERT INTO resolution.legal_entity_consolidation_decision (
      from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id, evidence_id,
      researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      review_candidate_id, supersedes_id, supersede_reason)
  VALUES (
      prop.from_legal_entity_id, prop.to_legal_entity_id, 'MATCHED', 'CONSOLIDATION_APPROVED',
      p_rationale, 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id, prop.evidence_id,
      prop.researcher_citation_url, prop.researcher_citation_title, prop.researcher_citation_excerpt,
      prop.review_candidate_id, p_proposal_id, 'approve pending consolidation proposal')
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION resolution.reverse_legal_entity_consolidation(
  p_from_legal_entity_id uuid,
  p_expected_current_id bigint,
  p_decided_by text,
  p_rationale text,
  p_evidence_id bigint,
  p_researcher_citation_url text,
  p_researcher_citation_title text,
  p_researcher_citation_excerpt text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, resolution, identity, ops, evidence
AS $$
DECLARE
  head resolution.legal_entity_consolidation_decision%ROWTYPE;
  run_id bigint;
  rule_id bigint;
  new_id bigint;
BEGIN
  PERFORM resolution.assert_consolidation_writer();
  IF coalesce(btrim(p_decided_by), '') = '' OR coalesce(btrim(p_rationale), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'consolidation reversal requires decided_by and rationale';
  END IF;

  SELECT * INTO head
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = p_from_legal_entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no current consolidation to reverse';
  END IF;
  IF head.id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'consolidation reversal is stale: current head changed';
  END IF;
  IF head.state IS DISTINCT FROM 'MATCHED' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'only an approved MATCHED consolidation can be reversed';
  END IF;

  PERFORM pg_advisory_xact_lock(872014, hashtext(p_from_legal_entity_id::text));

  SELECT * INTO head
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = p_from_legal_entity_id;
  IF head.id IS DISTINCT FROM p_expected_current_id OR head.state IS DISTINCT FROM 'MATCHED' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'consolidation reversal is stale after lock';
  END IF;

  rule_id := resolution.consolidation_rule_version_id();
  run_id := resolution.begin_consolidation_run(jsonb_build_object(
    'action', 'reverse',
    'from', p_from_legal_entity_id,
    'prior_to', head.to_legal_entity_id
  ));

  INSERT INTO resolution.legal_entity_consolidation_decision (
      from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id, evidence_id,
      researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
      supersedes_id, supersede_reason)
  VALUES (
      p_from_legal_entity_id, NULL, 'REJECTED', 'CONSOLIDATION_REVERSED',
      p_rationale, 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id, p_evidence_id,
      p_researcher_citation_url, p_researcher_citation_title, p_researcher_citation_excerpt,
      head.id, 'reverse approved consolidation')
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION registry.legal_entity_consolidation_preview(p_legal_entity_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, registry, resolution, identity
AS $$
  SELECT CASE
    WHEN p_legal_entity_id IS NULL THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = p_legal_entity_id) THEN NULL
    ELSE json_build_object(
      'legal_entity_id', p_legal_entity_id,
      'canonical_legal_entity_id', resolution.canonical_legal_entity(p_legal_entity_id),
      'creation_reason', (SELECT creation_reason FROM identity.legal_entity WHERE id = p_legal_entity_id),
      'aliases', coalesce((
        SELECT json_agg(json_build_object(
                 'alias_text', a.alias_text,
                 'verification_state', a.verification_state
               ) ORDER BY a.id)
        FROM identity.legal_entity_alias a
        WHERE a.legal_entity_id = p_legal_entity_id
          AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id)
      ), '[]'::json),
      'current_consolidation', (
        SELECT json_build_object(
          'id', c.id,
          'from_legal_entity_id', c.from_legal_entity_id,
          'to_legal_entity_id', c.to_legal_entity_id,
          'state', c.state::text,
          'method', c.method,
          'rationale', c.rationale,
          'decided_by', c.decided_by,
          'decided_at', c.decided_at
        )
        FROM resolution.current_legal_entity_consolidation c
        WHERE c.from_legal_entity_id = p_legal_entity_id
      )
    )
  END
$$;
COMMENT ON FUNCTION registry.legal_entity_consolidation_preview(uuid) IS
  'Read-only Admin preview of one legal entity: aliases, canonical id, and current consolidation head. Returns NULL when the entity does not exist.';

CREATE FUNCTION registry.list_pending_legal_entity_consolidations()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, registry, resolution
AS $$
  SELECT coalesce(json_agg(json_build_object(
           'id', c.id,
           'from_legal_entity_id', c.from_legal_entity_id,
           'to_legal_entity_id', c.to_legal_entity_id,
           'state', c.state::text,
           'method', c.method,
           'rationale', c.rationale,
           'decided_by', c.decided_by,
           'decided_at', c.decided_at,
           'evidence_id', c.evidence_id,
           'researcher_citation_url', c.researcher_citation_url,
           'researcher_citation_title', c.researcher_citation_title,
           'researcher_citation_excerpt', c.researcher_citation_excerpt,
           'from_canonical_legal_entity_id', resolution.canonical_legal_entity(c.from_legal_entity_id),
           'to_canonical_legal_entity_id', resolution.canonical_legal_entity(c.to_legal_entity_id)
         ) ORDER BY c.id), '[]'::json)
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.state = 'PROBABLE'
$$;

GRANT USAGE ON SCHEMA resolution TO resolution_writer;
GRANT USAGE ON SCHEMA identity TO resolution_writer;
GRANT USAGE ON SCHEMA ops TO resolution_writer;
GRANT USAGE ON SCHEMA evidence TO resolution_writer;
GRANT USAGE ON SCHEMA review TO resolution_writer;
GRANT USAGE ON SCHEMA registry TO resolution_writer;

-- Admin consolidation preview/pending list are SECURITY INVOKER and Admin-only.
-- Grant the minimum schema/table access for those reads; never grant to bdc_reader.
GRANT USAGE ON SCHEMA registry TO admin_reader;
GRANT USAGE ON SCHEMA resolution TO admin_reader;
GRANT USAGE ON SCHEMA identity TO admin_reader;
GRANT SELECT ON identity.legal_entity TO admin_reader;
GRANT SELECT ON identity.legal_entity_alias TO admin_reader;

REVOKE ALL ON FUNCTION resolution.begin_consolidation_run(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolution.propose_legal_entity_consolidation(
  uuid, uuid, text, text, bigint, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolution.approve_legal_entity_consolidation(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolution.reverse_legal_entity_consolidation(
  uuid, bigint, text, text, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.legal_entity_consolidation_preview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.list_pending_legal_entity_consolidations() FROM PUBLIC;

GRANT SELECT, INSERT ON resolution.legal_entity_consolidation_decision TO resolution_writer, bdc_pipeline_writer;
-- Admin INVOKER preview/list read the current-head view and underlying decision rows.
GRANT SELECT ON resolution.legal_entity_consolidation_decision TO admin_reader;
GRANT USAGE ON SEQUENCE resolution.legal_entity_consolidation_decision_id_seq TO resolution_writer, bdc_pipeline_writer;
GRANT SELECT ON resolution.current_legal_entity_consolidation
  TO resolution_writer, bdc_reader, bdc_pipeline_writer, admin_reader;
GRANT SELECT ON identity.legal_entity TO resolution_writer;
GRANT SELECT ON identity.legal_entity_alias TO resolution_writer;
GRANT SELECT ON ops.rule_version TO resolution_writer;
GRANT INSERT, SELECT ON ops.run TO resolution_writer;
GRANT INSERT, SELECT ON ops.run_outcome TO resolution_writer;
GRANT USAGE ON SEQUENCE ops.run_id_seq TO resolution_writer;
GRANT USAGE ON SEQUENCE ops.run_outcome_id_seq TO resolution_writer;
GRANT SELECT ON evidence.evidence TO resolution_writer;
GRANT SELECT ON review.candidate TO resolution_writer;

GRANT EXECUTE ON FUNCTION resolution.assert_consolidation_writer() TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.consolidation_rule_version_id() TO resolution_writer, bdc_reader;
GRANT EXECUTE ON FUNCTION resolution.begin_consolidation_run(jsonb) TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.propose_legal_entity_consolidation(
  uuid, uuid, text, text, bigint, text, text, text, bigint) TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.approve_legal_entity_consolidation(bigint, text, text) TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.reverse_legal_entity_consolidation(
  uuid, bigint, text, text, bigint, text, text, text) TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.canonical_legal_entity(uuid) TO bdc_reader, resolution_writer, admin_reader;
GRANT EXECUTE ON FUNCTION resolution.legal_entities_with_canonical(uuid) TO bdc_reader, resolution_writer, admin_reader;
-- Admin-only operational reads (pending proposals expose researcher citations).
GRANT EXECUTE ON FUNCTION registry.legal_entity_consolidation_preview(uuid) TO admin_reader;
GRANT EXECUTE ON FUNCTION registry.list_pending_legal_entity_consolidations() TO admin_reader;

SELECT ops.apply_append_only_to_all();
