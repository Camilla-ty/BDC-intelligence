-- 0061 legal-entity consolidation integrity.
-- 1) Pending PROBABLE proposals that supersede an approved MATCHED head must not
--    clear the effective canonical mapping (canonical follows the still-approved edge).
-- 2) Consolidation writes are helper-only: revoke direct INSERT from bdc_pipeline_writer
--    (same pattern as review.* base tables).
-- 3) Reverse may clear a pending replacement that sits on top of MATCHED.
-- 4) Reject/withdraw of a pending proposal restores the prior approved mapping when present.

CREATE OR REPLACE FUNCTION resolution.approved_consolidation_target(p_from_legal_entity_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, resolution
AS $$
  SELECT CASE
    WHEN c.state = 'MATCHED' AND c.to_legal_entity_id IS NOT NULL THEN c.to_legal_entity_id
    WHEN c.state = 'PROBABLE'
         AND prior.state = 'MATCHED'
         AND prior.to_legal_entity_id IS NOT NULL
      THEN prior.to_legal_entity_id
    ELSE NULL
  END
  FROM resolution.current_legal_entity_consolidation c
  LEFT JOIN resolution.legal_entity_consolidation_decision prior
    ON prior.id = c.supersedes_id
  WHERE c.from_legal_entity_id = p_from_legal_entity_id
$$;
COMMENT ON FUNCTION resolution.approved_consolidation_target(uuid) IS
  'Effective approved consolidation target for one source UUID. A pending PROBABLE head that supersedes MATCHED keeps the MATCHED target. REJECTED and first-time PROBABLE yield NULL.';

CREATE OR REPLACE FUNCTION resolution.canonical_legal_entity(p_legal_entity_id uuid)
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

    nxt := resolution.approved_consolidation_target(cur);
    IF nxt IS NULL THEN
      RETURN cur;
    END IF;
    cur := nxt;
  END LOOP;
END
$$;
COMMENT ON FUNCTION resolution.canonical_legal_entity(uuid) IS
  'Follows effective approved consolidation targets (MATCHED, or MATCHED under a pending PROBABLE) to the terminal legal_entity UUID. First-time pending proposals and REJECTED heads do not redirect. Missing entities return NULL. Cycles raise BDCI2.';

COMMENT ON VIEW resolution.current_legal_entity_consolidation IS
  'Current consolidation head per from_legal_entity_id (append-only tip). Effective canonical redirects follow MATCHED targets via resolution.approved_consolidation_target, including a MATCHED edge still in force when a newer pending PROBABLE head supersedes it. First-time PROBABLE and REJECTED heads do not redirect.';

-- Cycle prevention on INSERT of MATCHED follows effective approved edges (including
-- MATCHED targets still in force under a pending PROBABLE head).
CREATE OR REPLACE FUNCTION resolution.check_legal_entity_consolidation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, resolution, identity
AS $$
DECLARE
  walk uuid;
  depth integer := 0;
  seen uuid[] := ARRAY[]::uuid[];
  next_target uuid;
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

  IF NEW.state = 'MATCHED' AND NEW.to_legal_entity_id IS NOT NULL THEN
    walk := NEW.to_legal_entity_id;
    LOOP
      IF walk = NEW.from_legal_entity_id THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval would create a cycle';
      END IF;
      IF walk = ANY (seen) THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval: existing cycle in approved chain';
      END IF;
      depth := depth + 1;
      IF depth > 64 THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCI2',
          MESSAGE = 'consolidation approval: approved chain too deep';
      END IF;
      seen := seen || walk;
      next_target := resolution.approved_consolidation_target(walk);
      EXIT WHEN next_target IS NULL;
      walk := next_target;
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION resolution.reverse_legal_entity_consolidation(
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
  prior resolution.legal_entity_consolidation_decision%ROWTYPE;
  run_id bigint;
  rule_id bigint;
  new_id bigint;
  effective_to uuid;
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

  effective_to := resolution.approved_consolidation_target(p_from_legal_entity_id);
  IF effective_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'only an effective approved consolidation can be reversed';
  END IF;
  IF head.state = 'MATCHED' THEN
    NULL; -- direct approved head
  ELSIF head.state = 'PROBABLE' THEN
    SELECT * INTO prior FROM resolution.legal_entity_consolidation_decision WHERE id = head.supersedes_id;
    IF prior.state IS DISTINCT FROM 'MATCHED' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS2',
        MESSAGE = 'pending proposal without an approved mapping cannot be reversed; reject the proposal instead';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'current consolidation head cannot be reversed';
  END IF;

  PERFORM pg_advisory_xact_lock(872014, hashtext(p_from_legal_entity_id::text));

  SELECT * INTO head
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = p_from_legal_entity_id;
  IF head.id IS DISTINCT FROM p_expected_current_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'consolidation reversal is stale after lock';
  END IF;
  IF resolution.approved_consolidation_target(p_from_legal_entity_id) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'consolidation reversal is stale after lock';
  END IF;

  rule_id := resolution.consolidation_rule_version_id();
  run_id := resolution.begin_consolidation_run(jsonb_build_object(
    'action', 'reverse',
    'from', p_from_legal_entity_id,
    'prior_to', effective_to
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

CREATE OR REPLACE FUNCTION resolution.reject_legal_entity_consolidation_proposal(
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
  prior resolution.legal_entity_consolidation_decision%ROWTYPE;
  head_id bigint;
  run_id bigint;
  rule_id bigint;
  new_id bigint;
BEGIN
  PERFORM resolution.assert_consolidation_writer();
  IF coalesce(btrim(p_decided_by), '') = '' OR coalesce(btrim(p_rationale), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'consolidation proposal rejection requires decided_by and rationale';
  END IF;

  SELECT * INTO prop
  FROM resolution.legal_entity_consolidation_decision
  WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'consolidation proposal not found';
  END IF;
  IF prop.state IS DISTINCT FROM 'PROBABLE' OR prop.method IS DISTINCT FROM 'CONSOLIDATION_PROPOSED' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2', MESSAGE = 'only a pending PROBABLE proposal can be rejected';
  END IF;

  SELECT c.id INTO head_id
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = prop.from_legal_entity_id;
  IF head_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'consolidation proposal rejection is stale: proposal is not the current head';
  END IF;

  PERFORM pg_advisory_xact_lock(872014, hashtext(prop.from_legal_entity_id::text));

  SELECT c.id INTO head_id
  FROM resolution.current_legal_entity_consolidation c
  WHERE c.from_legal_entity_id = prop.from_legal_entity_id;
  IF head_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS2',
      MESSAGE = 'consolidation proposal rejection is stale after lock';
  END IF;

  rule_id := resolution.consolidation_rule_version_id();
  run_id := resolution.begin_consolidation_run(jsonb_build_object(
    'action', 'reject_proposal',
    'proposal_id', p_proposal_id,
    'from', prop.from_legal_entity_id
  ));

  IF prop.supersedes_id IS NOT NULL THEN
    SELECT * INTO prior
    FROM resolution.legal_entity_consolidation_decision
    WHERE id = prop.supersedes_id;
  END IF;

  IF prior.id IS NOT NULL AND prior.state = 'MATCHED' AND prior.to_legal_entity_id IS NOT NULL THEN
    -- Restore the approved mapping as the current head without deleting history.
    INSERT INTO resolution.legal_entity_consolidation_decision (
        from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
        decided_by, decided_at, rule_version_id, run_id, evidence_id,
        researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
        review_candidate_id, supersedes_id, supersede_reason)
    VALUES (
        prop.from_legal_entity_id, prior.to_legal_entity_id, 'MATCHED', 'CONSOLIDATION_APPROVED',
        p_rationale, 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id, prior.evidence_id,
        prior.researcher_citation_url, prior.researcher_citation_title, prior.researcher_citation_excerpt,
        prior.review_candidate_id, p_proposal_id, 'reject pending proposal; restore approved consolidation')
    RETURNING id INTO new_id;
  ELSE
    INSERT INTO resolution.legal_entity_consolidation_decision (
        from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
        decided_by, decided_at, rule_version_id, run_id, evidence_id,
        researcher_citation_url, researcher_citation_title, researcher_citation_excerpt,
        review_candidate_id, supersedes_id, supersede_reason)
    VALUES (
        prop.from_legal_entity_id, NULL, 'REJECTED', 'CONSOLIDATION_REVERSED',
        p_rationale, 'HUMAN_REVIEW', p_decided_by, now(), rule_id, run_id, prop.evidence_id,
        prop.researcher_citation_url, prop.researcher_citation_title, prop.researcher_citation_excerpt,
        prop.review_candidate_id, p_proposal_id, 'reject pending proposal with no prior approved mapping')
    RETURNING id INTO new_id;
  END IF;
  RETURN new_id;
END
$$;

COMMENT ON FUNCTION resolution.reject_legal_entity_consolidation_proposal(bigint, text, text) IS
  'Rejects a pending PROBABLE proposal. If it superseded an approved MATCHED mapping, that mapping is restored as the current head. Otherwise a REJECTED head is recorded. Pending rejection never invents a new survivor.';

REVOKE ALL ON FUNCTION resolution.reject_legal_entity_consolidation_proposal(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolution.reject_legal_entity_consolidation_proposal(bigint, text, text)
  TO resolution_writer;
GRANT EXECUTE ON FUNCTION resolution.approved_consolidation_target(uuid)
  TO bdc_reader, resolution_writer, admin_reader;

-- Helper-only writes: pipeline must not INSERT consolidation decisions directly.
REVOKE INSERT ON resolution.legal_entity_consolidation_decision FROM bdc_pipeline_writer;
-- Keep SELECT so diagnostics/joins remain possible for the pipeline role.
GRANT SELECT ON resolution.legal_entity_consolidation_decision TO bdc_pipeline_writer;
