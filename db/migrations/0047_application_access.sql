-- 0047 application authorization ledger.
-- Supabase Auth owns identity (auth.users.id as user_id). This schema owns ADMIN and PRO
-- grants. MEMBER is implicit: an authenticated user with no active elevated grant.
-- Local and CI PostgreSQL have no auth schema; there is no foreign key to auth.users.
-- identity remains legal-entity/instrument identifiers (G-14). access is not public.

CREATE SCHEMA access;
COMMENT ON SCHEMA access IS 'Application authorization. Append-only ADMIN and PRO grants keyed by Supabase Auth user id. Not the identity layer.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'access_reader') THEN
    CREATE ROLE access_reader NOLOGIN;
  END IF;
END
$$;
COMMENT ON ROLE access_reader IS 'SELECT on access.current_access only. Not granted to a login role by this migration. Never granted to bdc_reader.';

CREATE TYPE access.grant_kind AS ENUM ('ADMIN', 'PRO');
CREATE TYPE access.grant_action AS ENUM ('GRANT', 'REVOKE');
CREATE TYPE access.grant_source AS ENUM ('BOOTSTRAP', 'OPERATOR', 'SUBSCRIPTION');

CREATE TABLE access.grant_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL,
  grant_kind     access.grant_kind NOT NULL,
  action         access.grant_action NOT NULL,
  source         access.grant_source NOT NULL,
  actor_user_id  uuid,
  reason         text NOT NULL CHECK (btrim(reason) <> ''),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_event_not_self CHECK (actor_user_id IS DISTINCT FROM user_id),
  CONSTRAINT grant_event_bootstrap_actor CHECK (
    (source = 'BOOTSTRAP' AND actor_user_id IS NULL)
    OR (source <> 'BOOTSTRAP' AND actor_user_id IS NOT NULL)
  )
);
COMMENT ON TABLE access.grant_event IS 'Immutable GRANT and REVOKE events. Current access is access.current_access. MEMBER is never stored.';
COMMENT ON COLUMN access.grant_event.user_id IS 'Supabase Auth user id (JWT sub). Not an email address.';
COMMENT ON COLUMN access.grant_event.actor_user_id IS 'Authenticated administrator who recorded the event. Null only for BOOTSTRAP.';

CREATE INDEX grant_event_lookup
  ON access.grant_event (user_id, grant_kind, created_at DESC, id DESC);

CREATE VIEW access.current_grant AS
SELECT DISTINCT ON (user_id, grant_kind)
  id, user_id, grant_kind, action, source, actor_user_id, reason, created_at
FROM access.grant_event
ORDER BY user_id, grant_kind, created_at DESC, id DESC;
COMMENT ON VIEW access.current_grant IS 'Latest event per user and grant kind. action GRANT means the kind is active; REVOKE means it is not.';

CREATE VIEW access.current_access AS
SELECT
  user_id,
  bool_or(grant_kind = 'ADMIN' AND action = 'GRANT') AS is_admin,
  bool_or(grant_kind = 'PRO' AND action = 'GRANT') AS is_pro,
  CASE
    WHEN bool_or(grant_kind = 'ADMIN' AND action = 'GRANT') THEN 'ADMIN'
    WHEN bool_or(grant_kind = 'PRO' AND action = 'GRANT') THEN 'PRO'
    ELSE 'MEMBER'
  END AS effective_role
FROM access.current_grant
GROUP BY user_id;
COMMENT ON VIEW access.current_access IS 'Users with at least one grant_event. Active ADMIN wins over active PRO. Users absent from this view are MEMBER if authenticated.';

CREATE FUNCTION access.record_grant(
  p_user_id uuid,
  p_grant_kind access.grant_kind,
  p_action access.grant_action,
  p_source access.grant_source,
  p_reason text,
  p_actor_user_id uuid
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
BEGIN
  INSERT INTO access.grant_event (user_id, grant_kind, action, source, actor_user_id, reason)
  VALUES (p_user_id, p_grant_kind, p_action, p_source, p_actor_user_id, p_reason)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;
COMMENT ON FUNCTION access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid) IS
  'Operator/bootstrap insert. EXECUTE is not granted to application roles. The web application must not call this.';

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
                        'resolution', 'validation', 'derived', 'ref', 'review', 'access')
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

REVOKE ALL ON SCHEMA access FROM PUBLIC;
GRANT USAGE ON SCHEMA access TO access_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA access FROM PUBLIC;
GRANT SELECT ON access.current_access TO access_reader;
REVOKE ALL ON FUNCTION access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION access.record_grant(uuid, access.grant_kind, access.grant_action, access.grant_source, text, uuid) FROM access_reader, bdc_reader, bdc_pipeline_writer, review_writer;

SELECT ops.apply_append_only_to_all();
