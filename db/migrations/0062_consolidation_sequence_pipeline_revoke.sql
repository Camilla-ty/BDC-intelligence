-- Migration 0062: revoke unused consolidation sequence USAGE from the pipeline role.
--
-- SECURITY DEFINER helpers insert as the function owner, so nextval does not need
-- invoker sequence privileges. bdc_pipeline_writer already cannot INSERT consolidation
-- decisions (0061). Leaving USAGE granted was residual privilege with no authorized path.

REVOKE USAGE ON SEQUENCE resolution.legal_entity_consolidation_decision_id_seq
  FROM bdc_pipeline_writer;

-- resolution_writer keeps USAGE: it holds INSERT on the decision table for helper-mediated
-- writes and any future owner-aligned paths that evaluate privileges as the writer role.
