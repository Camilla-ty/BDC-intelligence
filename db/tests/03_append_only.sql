-- Group 3: append-only history (G-10). The table list comes from the catalog, so a new table
-- without the triggers fails here.

SELECT pg_temp.check('every layer table has row-level and TRUNCATE append-only triggers', NOT EXISTS (
  SELECT 1
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review')
    AND (NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'append_only_row'
                       AND t.tgfoid = 'ops.forbid_mutation'::regproc AND t.tgenabled = 'O')
      OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'append_only_truncate'
                       AND t.tgfoid = 'ops.forbid_mutation'::regproc AND t.tgenabled = 'O'))));

-- Behavioral check on every table that holds rows after the fixture (plus seeded ref tables).
DO $$
DECLARE
  t record;
  col text;
  n bigint;
  tested integer := 0;
BEGIN
  FOR t IN
    SELECT n.nspname AS s, c.relname AS r, c.oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.s, t.r) INTO n;
    IF n > 0 THEN
      SELECT a.attname INTO col
      FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attidentity = '' AND a.attgenerated = ''
      ORDER BY a.attnum LIMIT 1;
      PERFORM pg_temp.expect_error(format('UPDATE %I.%I is rejected', t.s, t.r), 'BDCA1',
        ARRAY[format('UPDATE %I.%I SET %I = %I', t.s, t.r, col, col)]);
      PERFORM pg_temp.expect_error(format('DELETE %I.%I is rejected', t.s, t.r), 'BDCA1',
        ARRAY[format('DELETE FROM %I.%I', t.s, t.r)]);
      tested := tested + 1;
    END IF;
    PERFORM pg_temp.expect_error(format('TRUNCATE %I.%I is rejected', t.s, t.r), 'BDCA1',
      ARRAY[format('TRUNCATE %I.%I CASCADE', t.s, t.r)]);
  END LOOP;
  PERFORM pg_temp.check(format('UPDATE/DELETE exercised on %s populated tables', tested), tested >= 25);
END
$$;
