-- Application authorization ledger. MEMBER is never stored. No FK to auth.users.

SELECT pg_temp.check('access schema exists',
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'access'));

SELECT pg_temp.check('no foreign key from access to auth.users', NOT EXISTS (
  SELECT 1 FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class f ON f.oid = k.confrelid
  JOIN pg_namespace fn ON fn.oid = f.relnamespace
  WHERE k.contype = 'f' AND n.nspname = 'access' AND fn.nspname = 'auth'));

SELECT pg_temp.check('grant_event has no role column and no email column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'access' AND table_name = 'grant_event'
    AND column_name IN ('role', 'email', 'display_name')));

SELECT pg_temp.check('bdc_reader cannot use the access schema',
  NOT has_schema_privilege('bdc_reader', 'access', 'USAGE'));

SELECT pg_temp.check('bdc_reader cannot select grant_event or current_access',
  NOT has_table_privilege('bdc_reader', 'access.grant_event', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'access.current_access', 'SELECT'));

SELECT pg_temp.check('access_reader selects current_access only',
  has_table_privilege('access_reader', 'access.current_access', 'SELECT')
  AND NOT has_table_privilege('access_reader', 'access.grant_event', 'SELECT')
  AND NOT has_table_privilege('access_reader', 'access.grant_event', 'INSERT'));

SELECT pg_temp.check('pipeline and review roles cannot insert grant events',
  NOT has_table_privilege('bdc_pipeline_writer', 'access.grant_event', 'INSERT')
  AND NOT has_table_privilege('review_writer', 'access.grant_event', 'INSERT')
  AND NOT has_table_privilege('bdc_reader', 'access.grant_event', 'INSERT')
  AND NOT has_table_privilege('access_reader', 'access.grant_event', 'INSERT'));

SELECT pg_temp.check('application roles cannot execute record_grant',
  NOT has_function_privilege('bdc_reader', 'access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('access_reader', 'access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('bdc_pipeline_writer', 'access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('review_writer', 'access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid)', 'EXECUTE'));

SELECT pg_temp.expect_error('empty reason is rejected', '23514',
  ARRAY[$$INSERT INTO access.grant_event (user_id, grant_kind, action, source, reason)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ADMIN', 'GRANT', 'BOOTSTRAP', '   ')$$]);

SELECT pg_temp.expect_error('self-grant is rejected', '23514',
  ARRAY[$$INSERT INTO access.grant_event (user_id, grant_kind, action, source, actor_user_id, reason)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ADMIN', 'GRANT', 'OPERATOR',
                '00000000-0000-4000-8000-000000000001', 'TEST SELF GRANT')$$]);

SELECT pg_temp.expect_error('bootstrap cannot name an actor', '23514',
  ARRAY[$$INSERT INTO access.grant_event (user_id, grant_kind, action, source, actor_user_id, reason)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ADMIN', 'GRANT', 'BOOTSTRAP',
                '00000000-0000-4000-8000-000000000099', 'TEST BOOTSTRAP ACTOR')$$]);

SELECT pg_temp.expect_error('operator must name an actor', '23514',
  ARRAY[$$INSERT INTO access.grant_event (user_id, grant_kind, action, source, reason)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ADMIN', 'GRANT', 'OPERATOR', 'TEST OPERATOR NO ACTOR')$$]);

INSERT INTO access.grant_event (user_id, grant_kind, action, source, reason)
VALUES ('00000000-0000-4000-8000-000000000001', 'ADMIN', 'GRANT', 'BOOTSTRAP', 'TEST FIRST ADMIN');

INSERT INTO access.grant_event (user_id, grant_kind, action, source, actor_user_id, reason)
VALUES
  ('00000000-0000-4000-8000-000000000002', 'PRO', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST PRO GRANT'),
  ('00000000-0000-4000-8000-000000000003', 'ADMIN', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST ADMIN'),
  ('00000000-0000-4000-8000-000000000003', 'PRO', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST ADMIN ALSO PRO'),
  ('00000000-0000-4000-8000-000000000004', 'PRO', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST THEN REVOKE'),
  ('00000000-0000-4000-8000-000000000004', 'PRO', 'REVOKE', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST REVOKE AFTER GRANT'),
  ('00000000-0000-4000-8000-000000000005', 'ADMIN', 'REVOKE', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST REVOKE FIRST'),
  ('00000000-0000-4000-8000-000000000005', 'ADMIN', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST GRANT AFTER REVOKE'),
  ('00000000-0000-4000-8000-000000000006', 'PRO', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST OLD PRO'),
  ('00000000-0000-4000-8000-000000000006', 'PRO', 'REVOKE', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST MIDDLE REVOKE'),
  ('00000000-0000-4000-8000-000000000006', 'PRO', 'GRANT', 'OPERATOR',
   '00000000-0000-4000-8000-000000000001', 'TEST LATEST GRANT');

SELECT pg_temp.check('no grant_event means no current_access row (MEMBER is implicit)',
  NOT EXISTS (SELECT 1 FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000099'));

SELECT pg_temp.check('bootstrap ADMIN is ADMIN',
  (SELECT effective_role FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000001') = 'ADMIN');

SELECT pg_temp.check('active PRO is PRO',
  (SELECT effective_role FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000002') = 'PRO');

SELECT pg_temp.check('ADMIN plus PRO is ADMIN',
  (SELECT is_admin AND is_pro AND effective_role = 'ADMIN'
     FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000003'));

SELECT pg_temp.check('GRANT then REVOKE is inactive',
  NOT EXISTS (SELECT 1 FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000004' AND is_pro)
  AND (SELECT action FROM access.current_grant
       WHERE user_id = '00000000-0000-4000-8000-000000000004' AND grant_kind = 'PRO') = 'REVOKE');

SELECT pg_temp.check('REVOKE then GRANT is active',
  (SELECT is_admin AND effective_role = 'ADMIN'
     FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000005'));

SELECT pg_temp.check('latest of several events wins',
  (SELECT is_pro AND effective_role = 'PRO'
     FROM access.current_access WHERE user_id = '00000000-0000-4000-8000-000000000006'));

SELECT pg_temp.expect_ok('access_reader can read current_access', ARRAY[
  'SET ROLE access_reader',
  'SELECT effective_role FROM access.current_access WHERE user_id = ''00000000-0000-4000-8000-000000000001''',
  'RESET ROLE']);

SELECT pg_temp.expect_error('access_reader cannot read grant_event', '42501',
  ARRAY['SET ROLE access_reader', 'SELECT count(*) FROM access.grant_event']);

SELECT pg_temp.expect_error('access_reader cannot insert grant_event', '42501',
  ARRAY['SET ROLE access_reader',
        $$INSERT INTO access.grant_event (user_id, grant_kind, action, source, reason)
          VALUES ('00000000-0000-4000-8000-000000000007', 'ADMIN', 'GRANT', 'BOOTSTRAP', 'TEST READER INSERT')$$]);

SELECT pg_temp.expect_error('bdc_reader cannot read current_access', '42501',
  ARRAY['SET ROLE bdc_reader', 'SELECT count(*) FROM access.current_access']);
