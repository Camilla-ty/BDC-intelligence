-- Group 51: filing-scoped registrant lateral on borrower_observation_listing.
-- Must match registry.current_filing_registrant semantics (LINKED / MULTIPLE /
-- UNKNOWN, supersession) without reading that view from the listing definition.

-- Filing-scoped pick identical to the LIMIT 1 applied by borrower_observation_listing.
CREATE FUNCTION pg_temp.listing_registrant_pick(p_filing_id bigint)
RETURNS TABLE (
  registrant_id bigint,
  cik bigint,
  registrant_link_status text
)
LANGUAGE sql
STABLE
AS $$
  SELECT x.registrant_id, x.cik, x.registrant_link_status
  FROM (
    SELECT h.registrant_id,
           r.cik,
           CASE
             WHEN h.id IS NULL THEN 'UNKNOWN'
             WHEN pf.registrant_count > 1 THEN 'MULTIPLE'
             ELSE 'LINKED'
           END AS registrant_link_status
    FROM (SELECT p_filing_id AS filing_id) AS scoped
    LEFT JOIN LATERAL (
      SELECT l.id, l.registrant_id
      FROM registry.filing_registrant_link l
      WHERE l.filing_id = scoped.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT l.registrant_id) AS registrant_count
      FROM registry.filing_registrant_link l
      WHERE l.filing_id = scoped.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
    ) pf ON true
    LEFT JOIN registry.registrant r ON r.id = h.registrant_id
  ) x
  ORDER BY CASE WHEN x.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, x.registrant_id
  LIMIT 1
$$;

CREATE FUNCTION pg_temp.cfr_listing_pick(p_filing_id bigint)
RETURNS TABLE (
  registrant_id bigint,
  cik bigint,
  registrant_link_status text
)
LANGUAGE sql
STABLE
AS $$
  SELECT cfr.registrant_id, cfr.cik, cfr.registrant_link_status
  FROM registry.current_filing_registrant cfr
  WHERE cfr.filing_id = p_filing_id
  ORDER BY CASE WHEN cfr.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, cfr.registrant_id
  LIMIT 1
$$;

-- Fixture filings: linked (setup default), unknown, multiple, superseded.
SELECT pg_temp.expect_ok('listing registrant fixture filings', ARRAY[
  format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id)
           VALUES ('0000000000-00-000010', %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id)
           VALUES ('0000000000-00-000011', %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id)
           VALUES ('0000000000-00-000012', %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id)
           VALUES (9999999903, %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.put('filing_unknown',
  (SELECT id FROM registry.filing WHERE accession_number = '0000000000-00-000010'));
SELECT pg_temp.put('filing_multiple',
  (SELECT id FROM registry.filing WHERE accession_number = '0000000000-00-000011'));
SELECT pg_temp.put('filing_supersede',
  (SELECT id FROM registry.filing WHERE accession_number = '0000000000-00-000012'));
SELECT pg_temp.put('registrant_b',
  (SELECT id FROM registry.registrant WHERE cik = 9999999903));

-- MULTIPLE: two current links to different registrants.
SELECT pg_temp.expect_ok('multiple registrant links', ARRAY[
  format($$INSERT INTO registry.filing_registrant_link
             (filing_id, registrant_id, link_source, run_id, evidence_id)
           VALUES (%s, %s, 'SUBMISSIONS_JSON', %s, %s)$$,
         pg_temp.fx('filing_multiple'), pg_temp.fx('registrant'),
         pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link
             (filing_id, registrant_id, link_source, run_id, evidence_id)
           VALUES (%s, %s, 'SUBMISSIONS_JSON', %s, %s)$$,
         pg_temp.fx('filing_multiple'), pg_temp.fx('registrant_b'),
         pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

-- Superseded: first link superseded by second to the same registrant (still LINKED).
SELECT pg_temp.expect_ok('superseded registrant link', ARRAY[
  format($$INSERT INTO registry.filing_registrant_link
             (filing_id, registrant_id, link_source, run_id, evidence_id)
           VALUES (%s, %s, 'SUB_TABLE', %s, %s)$$,
         pg_temp.fx('filing_supersede'), pg_temp.fx('registrant'),
         pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.put('link_old',
  (SELECT id FROM registry.filing_registrant_link
   WHERE filing_id = pg_temp.fx('filing_supersede') ORDER BY id LIMIT 1));

SELECT pg_temp.expect_ok('superseding registrant link', ARRAY[
  format($$INSERT INTO registry.filing_registrant_link
             (filing_id, registrant_id, link_source, run_id, evidence_id,
              supersedes_id, supersede_reason)
           VALUES (%s, %s, 'SUBMISSIONS_JSON', %s, %s, %s, 'TEST ONLY supersede')$$,
         pg_temp.fx('filing_supersede'), pg_temp.fx('registrant'),
         pg_temp.fx('run'), pg_temp.fx('e_sub'), pg_temp.fx('link_old'))]);

SELECT pg_temp.check('LINKED: filing-scoped pick equals current_filing_registrant pick', (
  SELECT scoped.registrant_id IS NOT DISTINCT FROM cfr.registrant_id
     AND scoped.cik IS NOT DISTINCT FROM cfr.cik
     AND scoped.registrant_link_status = cfr.registrant_link_status
     AND scoped.registrant_link_status = 'LINKED'
     AND scoped.registrant_id = pg_temp.fx('registrant')
  FROM pg_temp.listing_registrant_pick(pg_temp.fx('filing')) scoped
  CROSS JOIN pg_temp.cfr_listing_pick(pg_temp.fx('filing')) cfr));

SELECT pg_temp.check('UNKNOWN: filing-scoped pick equals current_filing_registrant pick', (
  SELECT scoped.registrant_id IS NULL
     AND cfr.registrant_id IS NULL
     AND scoped.cik IS NULL
     AND cfr.cik IS NULL
     AND scoped.registrant_link_status = 'UNKNOWN'
     AND cfr.registrant_link_status = 'UNKNOWN'
  FROM pg_temp.listing_registrant_pick(pg_temp.fx('filing_unknown')) scoped
  CROSS JOIN pg_temp.cfr_listing_pick(pg_temp.fx('filing_unknown')) cfr));

SELECT pg_temp.check('MULTIPLE: filing-scoped pick equals current_filing_registrant pick', (
  SELECT scoped.registrant_id IS NOT DISTINCT FROM cfr.registrant_id
     AND scoped.cik IS NOT DISTINCT FROM cfr.cik
     AND scoped.registrant_link_status = 'MULTIPLE'
     AND cfr.registrant_link_status = 'MULTIPLE'
     AND scoped.registrant_id = (
       SELECT min(registrant_id) FROM registry.current_filing_registrant
       WHERE filing_id = pg_temp.fx('filing_multiple'))
  FROM pg_temp.listing_registrant_pick(pg_temp.fx('filing_multiple')) scoped
  CROSS JOIN pg_temp.cfr_listing_pick(pg_temp.fx('filing_multiple')) cfr));

SELECT pg_temp.check('MULTIPLE still has two current_filing_registrant rows', (
  SELECT count(*) = 2 AND bool_and(registrant_link_status = 'MULTIPLE')
  FROM registry.current_filing_registrant
  WHERE filing_id = pg_temp.fx('filing_multiple')));

SELECT pg_temp.check('superseded link: only the head remains LINKED and picks match', (
  SELECT scoped.registrant_link_status = 'LINKED'
     AND cfr.registrant_link_status = 'LINKED'
     AND scoped.registrant_id = pg_temp.fx('registrant')
     AND scoped.registrant_id IS NOT DISTINCT FROM cfr.registrant_id
     AND (SELECT count(*) FROM registry.current_filing_registrant
          WHERE filing_id = pg_temp.fx('filing_supersede')) = 1
  FROM pg_temp.listing_registrant_pick(pg_temp.fx('filing_supersede')) scoped
  CROSS JOIN pg_temp.cfr_listing_pick(pg_temp.fx('filing_supersede')) cfr));

-- Listing regression: MATCHED observation on the default LINKED filing.
SELECT pg_temp.add_identifier_position('list_pos', 'TEST LISTING ENTITY | LOAN', 160);
INSERT INTO obs.borrower_name_observation (
    position_observation_id, source_column_label, source_column_position,
    raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
VALUES (pg_temp.fx('list_pos'), 'Investment, Identifier Axis', 6,
        'TEST LISTING ENTITY | LOAN', 'TEST LISTING ENTITY | LOAN', 'EXTRACTED',
        pg_temp.fx('r_field'), pg_temp.fx('list_pos_cell'), pg_temp.fx('run'));

SELECT pg_temp.expect_ok('listing legal entity and verified alias', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id)
           VALUES ('TEST ONLY listing scoped entity', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity_alias
             (legal_entity_id, alias_text, verification_state, rule_version_id, evidence_id, run_id)
           SELECT id, 'TEST LISTING ENTITY', 'VERIFIED', %s, %s, %s
           FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY listing scoped entity'$$,
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

INSERT INTO resolution.entity_resolution_decision (
    borrower_name_observation_id, legal_entity_id, state, method, rationale,
    actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
       'TEST ONLY: listing entity', 'SYSTEM_RULE', 'db tests', now(),
       pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
FROM obs.current_borrower_name_observation b
JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY listing scoped entity'
WHERE b.position_observation_id = pg_temp.fx('list_pos');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('listing registrant fields match current_filing_registrant for the observation filing', (
  SELECT l.registrant_link_status = cfr.registrant_link_status
     AND l.registrant_link_status = 'LINKED'
     AND l.registrant_cik = lpad(cfr.cik::text, 10, '0')
     AND l.registrant_cik = '9999999901'
  FROM registry.borrower_observation_listing l
  CROSS JOIN pg_temp.cfr_listing_pick(pg_temp.fx('filing')) cfr
  WHERE l.legal_entity_id = (
    SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY listing scoped entity')
  LIMIT 1));

SELECT pg_temp.check('listing view no longer references current_filing_registrant', (
  SELECT position('current_filing_registrant' IN pg_get_viewdef('registry.borrower_observation_listing'::regclass, true)) = 0
     AND position('filing_registrant_link' IN pg_get_viewdef('registry.borrower_observation_listing'::regclass, true)) > 0));

SELECT pg_temp.check('current_filing_registrant definition is unchanged', (
  SELECT position('WITH heads AS' IN pg_get_viewdef('registry.current_filing_registrant'::regclass, true)) > 0
     AND position('per_filing AS' IN pg_get_viewdef('registry.current_filing_registrant'::regclass, true)) > 0));

SELECT pg_temp.expect_ok('reader can still select borrower listing', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.borrower_observation_listing',
  'RESET ROLE']);
