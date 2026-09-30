-- 0013 supersession NOT NULL lookup (Phase 3 performance).
-- IS NOT DISTINCT FROM is not a btree Index Cond. Use "=" for NOT NULL subject columns
-- so single_chain first inserts can use the 0012 subject indexes. Nullable columns keep
-- IS NOT DISTINCT FROM. BDCS1 messages and single_chain rules are unchanged.

CREATE OR REPLACE FUNCTION ops.check_supersession() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cols text[] := string_to_array(TG_ARGV[0], ',');
  chain_mode text := TG_ARGV[1];
  subject_match text;
  n_cols integer;
  n_matched integer;
  found boolean;
BEGIN
  SELECT count(*) INTO n_cols FROM unnest(cols) AS c WHERE btrim(c) <> '';
  SELECT string_agg(
           format(
             CASE WHEN a.attnotnull
               THEN 't.%I = ($1).%I'
               ELSE 't.%I IS NOT DISTINCT FROM ($1).%I'
             END,
             btrim(x.c), btrim(x.c)),
           ' AND ' ORDER BY x.ord),
         count(*)
    INTO subject_match, n_matched
  FROM unnest(cols) WITH ORDINALITY AS x(c, ord)
  JOIN pg_attribute a
    ON a.attrelid = format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME)::regclass
   AND a.attname = btrim(x.c)
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE btrim(x.c) <> '';
  IF subject_match IS NULL OR n_matched <> n_cols THEN
    RAISE EXCEPTION 'ops.check_supersession: subject column missing on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  IF NEW.supersedes_id IS NULL THEN
    IF NEW.supersede_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersede_reason given without supersedes_id', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    IF chain_mode = 'single_chain' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE %s)',
                     TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
        INTO found USING NEW;
      IF found THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCS1',
          MESSAGE = format('%I.%I: this subject already has a row; insert a row that supersedes the current one',
                           TG_TABLE_SCHEMA, TG_TABLE_NAME);
      END IF;
    END IF;
  ELSE
    IF coalesce(btrim(NEW.supersede_reason), '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: a superseding row needs a supersede_reason', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE t.id = ($1).supersedes_id AND %s)',
                   TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
      INTO found USING NEW;
    IF NOT found THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersedes_id must reference a row of the same table with the same subject (%s)',
                         TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
    END IF;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION ops.check_supersession() IS
  'G-10: first single_chain insert rejects an existing subject; a superseding row must share subject columns and carry a reason. NOT NULL subject columns compare with = so a btree Index Cond can be used; nullable columns keep IS NOT DISTINCT FROM.';

SELECT ops.apply_append_only_to_all();
