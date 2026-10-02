-- 0021 SOI row-kind classification.
-- IDENTIFIER_ROW remains a non-empty identifier cell. NO_IDENTIFIER_ROW stays a valid
-- historical kind and is not rewritten. SUBTOTAL_ROW and DIMENSION_FACT_ROW are recorded
-- only by a later classification that supersedes the historical row. UNCLASSIFIED already
-- existed. A position remains one identifier-bearing SOI row. Q6 and Q14 are unchanged.

ALTER TYPE ref.row_kind ADD VALUE 'SUBTOTAL_ROW';
ALTER TYPE ref.row_kind ADD VALUE 'DIMENSION_FACT_ROW';

COMMENT ON TYPE ref.row_kind IS
  'IDENTIFIER_ROW: this row''s Investment, Identifier Axis cell is non-empty. NO_IDENTIFIER_ROW: historical classification of an empty identifier cell; existing rows stay stored. SUBTOTAL_ROW and DIMENSION_FACT_ROW: filing-evidence kinds recorded by a superseding classification, only when that cell is empty. UNCLASSIFIED: the evidence does not assign one of those kinds. A blank identifier is not copied from another row.';

COMMENT ON TABLE obs.soi_row_classification IS
  'Rule-versioned classification of a SOI row. Historical NO_IDENTIFIER_ROW rows stay stored. SUBTOTAL_ROW and DIMENSION_FACT_ROW are new rows that supersede them. Selecting current holdings is OPEN QUESTION Q6; UNRESOLVED is valid.';

COMMENT ON TABLE obs.position_observation IS
  'One identifier-bearing SOI row. The current classification of the origin is IDENTIFIER_ROW, and holding_descriptor_raw equals that row''s identifier cell. It is not an economically usable investment. Instrument and position links exist only as resolution decisions.';

CREATE FUNCTION obs.check_soi_row_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ident text;
BEGIN
  SELECT o.identifier_raw INTO ident
  FROM obs.soi_row_observation o
  WHERE o.id = NEW.soi_row_observation_id;

  IF NEW.row_kind::text = 'IDENTIFIER_ROW' AND ident IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'IDENTIFIER_ROW requires a non-empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IN ('NO_IDENTIFIER_ROW', 'SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND ident IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'this row kind requires an empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IS DISTINCT FROM 'IDENTIFIER_ROW'
     AND EXISTS (
       SELECT 1 FROM obs.position_observation p
       WHERE p.origin_soi_row_observation_id = NEW.soi_row_observation_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a position origin must stay IDENTIFIER_ROW';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_soi_row_classification
  BEFORE INSERT ON obs.soi_row_classification
  FOR EACH ROW EXECUTE FUNCTION obs.check_soi_row_classification();

CREATE OR REPLACE FUNCTION obs.check_position_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s obs.soi_row_observation;
  cell text;
BEGIN
  SELECT * INTO s FROM obs.soi_row_observation WHERE id = NEW.origin_soi_row_observation_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'position observation origin SOI row does not exist';
  END IF;
  cell := nullif(obs.cell_by_label(s.tabular_row_id, 'Investment, Identifier Axis'), '');
  IF cell IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a blank identifier cell cannot become a position';
  END IF;
  IF NEW.holding_descriptor_raw IS DISTINCT FROM cell THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'holding_descriptor_raw must equal the origin identifier cell';
  END IF;
  IF s.filing_id <> NEW.filing_id
     OR s.reported_date IS DISTINCT FROM NEW.reported_date
     OR s.date_precision <> NEW.date_precision
     OR s.duration_kind <> NEW.duration_kind
     OR s.identifier_raw IS DISTINCT FROM NEW.holding_descriptor_raw THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'position observation must match its origin SOI row (filing, date, duration, identifier)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = s.id AND c.row_kind = 'IDENTIFIER_ROW'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a position origin must be IDENTIFIER_ROW';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence.evidence e
    WHERE e.id = NEW.evidence_id AND e.tabular_row_id = s.tabular_row_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the origin SOI row';
  END IF;
  RETURN NEW;
END
$$;
