-- Group 16: SOI cik check uses head filing_registrant_link rows joined to registrant.cik.
-- Equivalent to registry.current_filing_registrant; superseded links must not match.
-- All values are obviously fake (TEST BDC 1/2, CIK 9999999901/9999999902, dates in 2099).

SELECT pg_temp.check('fixture SOI cik cell matches the current filing-registrant head', (
  SELECT bool_and(
    EXISTS (
      SELECT 1 FROM registry.current_filing_registrant c
      WHERE c.filing_id = o.filing_id
        AND c.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint)
    AND EXISTS (
      SELECT 1 FROM registry.filing_registrant_link l
      JOIN registry.registrant r ON r.id = l.registrant_id
      WHERE l.filing_id = o.filing_id
        AND r.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint
        AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id))
  )
  FROM obs.soi_row_observation o
  WHERE o.id IN (pg_temp.fx('soi_a'), pg_temp.fx('soi_b'))));

SELECT pg_temp.expect_ok('a head link may supersede an older link of the same filing', ARRAY[
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999902, %s, %s)$$,
         pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id,
              supersedes_id, supersede_reason)
           SELECT %s, id, 'SUBMISSIONS_JSON', %s, %s, %s, 'TEST ONLY: superseded registrant link'
           FROM registry.registrant WHERE cik = 9999999902$$,
         pg_temp.fx('filing'), pg_temp.fx('run'), pg_temp.fx('e_sub'), pg_temp.fx('link'))]);

SELECT pg_temp.check('after supersession the view names only the head CIK', (
  SELECT count(*) = 1 AND min(cik) = 9999999902 AND bool_and(registrant_link_status = 'LINKED')
  FROM registry.current_filing_registrant WHERE filing_id = pg_temp.fx('filing')));

SELECT pg_temp.check('head-link lookup agrees with the view for the new CIK', (
  EXISTS (
    SELECT 1 FROM registry.current_filing_registrant c
    WHERE c.filing_id = pg_temp.fx('filing') AND c.cik = 9999999902)
  AND EXISTS (
    SELECT 1 FROM registry.filing_registrant_link l
    JOIN registry.registrant r ON r.id = l.registrant_id
    WHERE l.filing_id = pg_temp.fx('filing') AND r.cik = 9999999902
      AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id))));

SELECT pg_temp.check('a superseded link CIK is not a current match', (
  NOT EXISTS (
    SELECT 1 FROM registry.current_filing_registrant c
    WHERE c.filing_id = pg_temp.fx('filing') AND c.cik = 9999999901)
  AND NOT EXISTS (
    SELECT 1 FROM registry.filing_registrant_link l
    JOIN registry.registrant r ON r.id = l.registrant_id
    WHERE l.filing_id = pg_temp.fx('filing') AND r.cik = 9999999901
      AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id))));

SELECT pg_temp.check('supersedes_id IS NULL is not the head condition', (
  EXISTS (
    SELECT 1 FROM registry.filing_registrant_link l
    JOIN registry.registrant r ON r.id = l.registrant_id
    WHERE l.filing_id = pg_temp.fx('filing') AND r.cik = 9999999901 AND l.supersedes_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM registry.filing_registrant_link l
    JOIN registry.registrant r ON r.id = l.registrant_id
    WHERE l.filing_id = pg_temp.fx('filing') AND r.cik = 9999999902 AND l.supersedes_id IS NULL)));

SELECT pg_temp.check('SOI cik cell of the fixture rows no longer matches after the head changed', (
  SELECT bool_and(
    NOT EXISTS (
      SELECT 1 FROM registry.current_filing_registrant c
      WHERE c.filing_id = o.filing_id
        AND c.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint)
    AND NOT EXISTS (
      SELECT 1 FROM registry.filing_registrant_link l
      JOIN registry.registrant r ON r.id = l.registrant_id
      WHERE l.filing_id = o.filing_id
        AND r.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint
        AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id))
  )
  FROM obs.soi_row_observation o
  WHERE o.id IN (pg_temp.fx('soi_a'), pg_temp.fx('soi_b'))));
