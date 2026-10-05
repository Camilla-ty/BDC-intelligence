-- 0031 durable research workspace.
-- A review candidate is a case to investigate. It is not a legal entity and not a
-- resolution decision. SAME, DIFFERENT, DEFERRED, and REOPENED are not stored here.
-- MATCHED, PROBABLE, UNRESOLVED, and REJECTED stay on the resolution layer.
--
-- evidence.evidence cannot hold this layer: every row requires an ingested artifact
-- and a pipeline run. An external URL has neither, and review writes must not create
-- them. Internal items reference existing evidence, filing, and position rows.
-- They do not copy artifact bytes or evidence text.
--
-- A future review.decision table can reference review.candidate and review.evidence_set.
-- It is intentionally not created in this migration.

CREATE SCHEMA review;
COMMENT ON SCHEMA review IS 'Research cases, source citations, researcher notes, and evidence sets. Not identity resolution.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'review_writer') THEN
    CREATE ROLE review_writer NOLOGIN;
  END IF;
END
$$;
COMMENT ON ROLE review_writer IS 'INSERT into review only. Not granted to a login role by this migration.';

CREATE TYPE review.candidate_type AS ENUM ('BORROWER');
CREATE TYPE review.case_status AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE review.evidence_origin AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE review.source_type AS ENUM (
  'INTERNAL_SEC_FILING',
  'COMPANY_WEBSITE',
  'SEC_FILING',
  'TRANSACTION_DOCUMENT',
  'COURT_DOCUMENT',
  'RATING_AGENCY',
  'STATE_REGISTRY',
  'OTHER'
);

CREATE TABLE review.candidate (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_key text NOT NULL UNIQUE CHECK (case_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  candidate_type review.candidate_type NOT NULL,
  source text NOT NULL CHECK (source IN ('MANUAL_SEED', 'RESEARCHER')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE review.candidate IS 'An investigation case. Status lives in review.candidate_status. This row is not a borrower and not a decision.';

CREATE TABLE review.candidate_status (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES review.candidate (id),
  status review.case_status NOT NULL,
  supersedes_id bigint REFERENCES review.candidate_status (id),
  supersede_reason text,
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE review.candidate_status IS 'Append-only OPEN or CLOSED. The first row is OPEN. Closing inserts a new row.';

CREATE TABLE review.candidate_member (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES review.candidate (id),
  position_observation_id bigint NOT NULL REFERENCES obs.position_observation (id),
  borrower_name_observation_id bigint REFERENCES obs.borrower_name_observation (id),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, position_observation_id)
);
COMMENT ON TABLE review.candidate_member IS 'The source observations included in a case. The observation row is not copied.';

CREATE TABLE review.evidence_item (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES review.candidate (id),
  origin review.evidence_origin NOT NULL,
  source_type review.source_type NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  source_url text,
  document_date date,
  retrieved_at timestamptz,
  relevant_excerpt text,
  position_observation_id bigint REFERENCES obs.position_observation (id),
  filing_document_id bigint REFERENCES registry.filing_document (id),
  evidence_id bigint REFERENCES evidence.evidence (id),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_item_origin_type CHECK (
    (origin = 'INTERNAL' AND source_type = 'INTERNAL_SEC_FILING')
    OR (origin = 'EXTERNAL' AND source_type <> 'INTERNAL_SEC_FILING')
  ),
  CONSTRAINT evidence_item_external_shape CHECK (
    origin <> 'EXTERNAL'
    OR (
      source_url ~ '^https://[^[:space:]]+$'
      AND relevant_excerpt IS NOT NULL
      AND btrim(relevant_excerpt) <> ''
      AND retrieved_at IS NOT NULL
      AND evidence_id IS NULL
      AND filing_document_id IS NULL
    )
  ),
  CONSTRAINT evidence_item_internal_shape CHECK (
    origin <> 'INTERNAL'
    OR (
      source_url IS NULL
      AND relevant_excerpt IS NULL
      AND retrieved_at IS NULL
      AND num_nonnulls(position_observation_id, filing_document_id, evidence_id) >= 1
    )
  )
);
COMMENT ON TABLE review.evidence_item IS 'A citation. INTERNAL references stored provenance. EXTERNAL is a researcher-added source and is not ingested.';
COMMENT ON COLUMN review.evidence_item.relevant_excerpt IS 'Required for a researcher-added source. Null for internal items so stored evidence text is not copied.';

CREATE TABLE review.researcher_note (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES review.candidate (id),
  evidence_item_id bigint REFERENCES review.evidence_item (id),
  note_text text NOT NULL CHECK (btrim(note_text) <> ''),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE review.researcher_note IS 'Researcher interpretation. It is not source evidence and it does not change an excerpt.';

CREATE TABLE review.evidence_set (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES review.candidate (id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text CHECK (description IS NULL OR btrim(description) <> ''),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE review.evidence_set IS 'A named collection for one research step. It stores no conclusion and no decision.';

CREATE TABLE review.evidence_set_member (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evidence_set_id bigint NOT NULL REFERENCES review.evidence_set (id),
  evidence_item_id bigint NOT NULL REFERENCES review.evidence_item (id),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_set_id, evidence_item_id)
);
COMMENT ON TABLE review.evidence_set_member IS 'Append-only membership. Removing an item is not granted.';

CREATE FUNCTION review.check_candidate_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, review
AS $$
BEGIN
  IF NEW.supersedes_id IS NULL AND NEW.status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'a review candidate opens as OPEN';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_candidate_status
  BEFORE INSERT ON review.candidate_status
  FOR EACH ROW EXECUTE FUNCTION review.check_candidate_status();

SELECT ops.add_supersession('review.candidate_status'::regclass, 'candidate_id', 'single_chain');

CREATE FUNCTION review.check_candidate_member() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, obs
AS $$
BEGIN
  IF NEW.borrower_name_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.id = NEW.borrower_name_observation_id
      AND b.position_observation_id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'borrower name observation does not belong to this position observation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_candidate_member
  BEFORE INSERT ON review.candidate_member
  FOR EACH ROW EXECUTE FUNCTION review.check_candidate_member();

CREATE FUNCTION review.check_evidence_item() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, review, obs, registry
AS $$
BEGIN
  IF NEW.position_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM review.candidate_member m
    WHERE m.candidate_id = NEW.candidate_id
      AND m.position_observation_id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'evidence can cite only a position observation that is a member of this candidate';
  END IF;
  IF NEW.position_observation_id IS NOT NULL AND NEW.filing_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM registry.filing_document d
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE d.id = NEW.filing_document_id
      AND p.id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'filing document does not belong to this position observation';
  END IF;
  IF NEW.position_observation_id IS NOT NULL AND NEW.evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.position_observation p
    WHERE p.id = NEW.position_observation_id AND p.evidence_id = NEW.evidence_id
    UNION ALL
    SELECT 1 FROM obs.position_field_value f
    WHERE f.position_observation_id = NEW.position_observation_id AND f.evidence_id = NEW.evidence_id
    UNION ALL
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = NEW.position_observation_id AND b.evidence_id = NEW.evidence_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'evidence row is not provenance for this position observation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_evidence_item
  BEFORE INSERT ON review.evidence_item
  FOR EACH ROW EXECUTE FUNCTION review.check_evidence_item();

CREATE FUNCTION review.check_researcher_note() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, review
AS $$
BEGIN
  IF NEW.evidence_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM review.evidence_item i
    WHERE i.id = NEW.evidence_item_id AND i.candidate_id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'researcher note must cite evidence from the same candidate';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_researcher_note
  BEFORE INSERT ON review.researcher_note
  FOR EACH ROW EXECUTE FUNCTION review.check_researcher_note();

CREATE FUNCTION review.check_evidence_set_member() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, review
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM review.evidence_set s
    JOIN review.evidence_item i ON i.candidate_id = s.candidate_id
    WHERE s.id = NEW.evidence_set_id AND i.id = NEW.evidence_item_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'an evidence set can include only evidence from the same candidate';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_evidence_set_member
  BEFORE INSERT ON review.evidence_set_member
  FOR EACH ROW EXECUTE FUNCTION review.check_evidence_set_member();

CREATE FUNCTION review.assert_writer() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'review_writer'
     AND NOT pg_has_role(session_user, 'review_writer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'review writes require review_writer';
  END IF;
END
$$;

CREATE FUNCTION review.open_candidate(
  p_case_key text,
  p_candidate_type text,
  p_source text,
  p_title text,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.candidate (case_key, candidate_type, source, title, created_by)
  VALUES (p_case_key, p_candidate_type::review.candidate_type, p_source, p_title, p_created_by)
  RETURNING id INTO new_id;
  INSERT INTO review.candidate_status (candidate_id, status, created_by)
  VALUES (new_id, 'OPEN', p_created_by);
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_member(
  p_candidate_id bigint,
  p_position_observation_id bigint,
  p_borrower_name_observation_id bigint,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.candidate_member (
    candidate_id, position_observation_id, borrower_name_observation_id, created_by)
  VALUES (p_candidate_id, p_position_observation_id, p_borrower_name_observation_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_internal_evidence(
  p_candidate_id bigint,
  p_title text,
  p_position_observation_id bigint,
  p_filing_document_id bigint,
  p_evidence_id bigint,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_item (
    candidate_id, origin, source_type, title,
    position_observation_id, filing_document_id, evidence_id, created_by)
  VALUES (
    p_candidate_id, 'INTERNAL', 'INTERNAL_SEC_FILING', p_title,
    p_position_observation_id, p_filing_document_id, p_evidence_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_external_evidence(
  p_candidate_id bigint,
  p_source_type text,
  p_title text,
  p_source_url text,
  p_document_date date,
  p_relevant_excerpt text,
  p_position_observation_id bigint,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_item (
    candidate_id, origin, source_type, title, source_url, document_date,
    retrieved_at, relevant_excerpt, position_observation_id, created_by)
  VALUES (
    p_candidate_id, 'EXTERNAL', p_source_type::review.source_type, p_title, p_source_url,
    p_document_date, clock_timestamp(), p_relevant_excerpt, p_position_observation_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_note(
  p_candidate_id bigint,
  p_evidence_item_id bigint,
  p_note_text text,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.researcher_note (candidate_id, evidence_item_id, note_text, created_by)
  VALUES (p_candidate_id, p_evidence_item_id, p_note_text, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_evidence_set(
  p_candidate_id bigint,
  p_title text,
  p_description text,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_set (candidate_id, title, description, created_by)
  VALUES (p_candidate_id, p_title, p_description, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_set_member(
  p_evidence_set_id bigint,
  p_evidence_item_id bigint,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_set_member (evidence_set_id, evidence_item_id, created_by)
  VALUES (p_evidence_set_id, p_evidence_item_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.set_candidate_status(
  p_candidate_id bigint,
  p_status text,
  p_reason text,
  p_created_by text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
DECLARE
  current_id bigint;
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  IF p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'review status is OPEN or CLOSED';
  END IF;
  SELECT s.id INTO current_id
  FROM review.candidate_status s
  WHERE s.candidate_id = p_candidate_id
    AND NOT EXISTS (SELECT 1 FROM review.candidate_status n WHERE n.supersedes_id = s.id);
  IF current_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'review candidate has no status';
  END IF;
  INSERT INTO review.candidate_status (candidate_id, status, supersedes_id, supersede_reason, created_by)
  VALUES (p_candidate_id, p_status::review.case_status, current_id, p_reason, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE VIEW review.current_candidate AS
SELECT c.id AS candidate_id,
       c.case_key,
       c.candidate_type::text AS candidate_type,
       c.source,
       c.title,
       s.status::text AS status,
       c.created_by,
       c.recorded_at AS created_at
FROM review.candidate c
JOIN review.candidate_status s ON s.candidate_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM review.candidate_status n WHERE n.supersedes_id = s.id
);
COMMENT ON VIEW review.current_candidate IS 'The current OPEN or CLOSED status. A candidate is not a resolved borrower.';

CREATE VIEW review.candidate_member_read AS
SELECT m.candidate_id,
       m.position_observation_id,
       m.borrower_name_observation_id,
       p.holding_descriptor_raw AS disclosed_line_text,
       p.filing_id,
       p.reported_date,
       p.evidence_id AS position_evidence_id,
       m.created_by,
       m.recorded_at AS created_at
FROM review.candidate_member m
JOIN obs.position_observation p ON p.id = m.position_observation_id;
COMMENT ON VIEW review.candidate_member_read IS 'Case membership plus the stored disclosed line. The observation is not copied into review.';

CREATE VIEW review.evidence_item_read AS
SELECT i.id AS evidence_item_id,
       i.candidate_id,
       i.origin::text AS origin,
       i.source_type::text AS source_type,
       i.title,
       COALESCE(i.source_url, d.document_url) AS source_url,
       d.document_name,
       i.document_date,
       i.retrieved_at,
       i.relevant_excerpt,
       p.holding_descriptor_raw AS stored_line_text,
       i.position_observation_id,
       i.filing_document_id,
       i.evidence_id,
       e.locator_type::text AS locator_type,
       e.html_row_ordinal,
       e.html_slot_ordinal,
       i.created_by,
       i.recorded_at AS created_at,
       CASE i.origin
         WHEN 'EXTERNAL' THEN 'RESEARCHER_ADDED_SOURCE'
         ELSE 'STORED_SEC_SOURCE'
       END AS source_trust
FROM review.evidence_item i
LEFT JOIN obs.position_observation p ON p.id = i.position_observation_id
LEFT JOIN registry.filing_document d ON d.id = i.filing_document_id
LEFT JOIN evidence.evidence e ON e.id = i.evidence_id;
COMMENT ON VIEW review.evidence_item_read IS 'Narrow provenance for a citation. Artifact bytes, storage keys, and checksums are not selected.';

CREATE VIEW review.researcher_note_read AS
SELECT n.id AS note_id,
       n.candidate_id,
       n.evidence_item_id,
       n.note_text,
       n.created_by,
       n.recorded_at AS created_at
FROM review.researcher_note n;
COMMENT ON VIEW review.researcher_note_read IS 'Researcher interpretation. The note text is not an excerpt.';

CREATE VIEW review.evidence_set_read AS
SELECT s.id AS evidence_set_id,
       s.candidate_id,
       s.title,
       s.description,
       s.created_by,
       s.recorded_at AS created_at
FROM review.evidence_set s;
COMMENT ON VIEW review.evidence_set_read IS 'A research collection. It has no decision column.';

CREATE VIEW review.evidence_set_member_read AS
SELECT m.evidence_set_id,
       m.evidence_item_id,
       m.created_by,
       m.recorded_at AS created_at
FROM review.evidence_set_member m;

REVOKE ALL ON SCHEMA review FROM PUBLIC;
GRANT USAGE ON SCHEMA review TO review_writer, bdc_reader;

REVOKE ALL ON ALL TABLES IN SCHEMA review FROM PUBLIC;
GRANT INSERT ON
  review.candidate,
  review.candidate_status,
  review.candidate_member,
  review.evidence_item,
  review.researcher_note,
  review.evidence_set,
  review.evidence_set_member
TO review_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA review TO review_writer;
GRANT SELECT ON
  review.current_candidate,
  review.candidate_member_read,
  review.evidence_item_read,
  review.researcher_note_read,
  review.evidence_set_read,
  review.evidence_set_member_read
TO bdc_reader, review_writer;

REVOKE ALL ON FUNCTION review.assert_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION review.open_candidate(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_member(bigint, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_internal_evidence(bigint, text, bigint, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_external_evidence(bigint, text, text, text, date, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_note(bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_evidence_set(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.add_set_member(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION review.set_candidate_status(bigint, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION review.open_candidate(text, text, text, text, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_member(bigint, bigint, bigint, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_internal_evidence(bigint, text, bigint, bigint, bigint, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_external_evidence(bigint, text, text, text, date, text, bigint, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_note(bigint, bigint, text, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_evidence_set(bigint, text, text, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.add_set_member(bigint, bigint, text) TO review_writer;
GRANT EXECUTE ON FUNCTION review.set_candidate_status(bigint, text, text, text) TO review_writer;

CREATE OR REPLACE FUNCTION ops.apply_append_only_to_all() RETURNS integer
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
                        'resolution', 'validation', 'derived', 'ref', 'review')
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

SELECT ops.apply_append_only_to_all();
