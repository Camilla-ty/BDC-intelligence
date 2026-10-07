-- 0044 stored industry and instrument type for one position.
-- The borrower page reads these current heads. A missing head is not a row.
-- The reader selects this view and does not need access to evidence.evidence.

CREATE VIEW obs.current_position_research_field AS
SELECT fv.position_observation_id,
       fv.field_code,
       fv.raw_value,
       fv.value_state,
       e.evidence_level
FROM obs.position_field_value fv
JOIN evidence.evidence e ON e.id = fv.evidence_id
WHERE fv.field_code IN ('INDUSTRY', 'INSTRUMENT_TYPE')
  AND NOT EXISTS (
    SELECT 1
    FROM obs.position_field_value newer
    WHERE newer.supersedes_id = fv.id);

COMMENT ON VIEW obs.current_position_research_field IS
  'Current INDUSTRY and INSTRUMENT_TYPE heads, with the evidence level of the stored value. A position with no current head has no row. Absence is not a value and is not copied from another row.';

SELECT ops.grant_layer_privileges();
