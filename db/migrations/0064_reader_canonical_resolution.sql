-- 0064 let the web reader resolve a canonical legal entity without base-table grants.
-- resolution.canonical_legal_entity, resolution.approved_consolidation_target, and
-- resolution.legal_entities_with_canonical stay read-only. They run as their owner so
-- bdc_reader can execute them without SELECT on identity.legal_entity or
-- resolution.legal_entity_consolidation_decision.
-- search_path is fixed and pg_temp is last. EXECUTE is removed from PUBLIC and kept
-- for the same three roles as 0060/0061, plus the migration role that owns the functions.

ALTER FUNCTION resolution.approved_consolidation_target(uuid) SECURITY DEFINER;
ALTER FUNCTION resolution.approved_consolidation_target(uuid)
  SET search_path = pg_catalog, resolution, pg_temp;

ALTER FUNCTION resolution.canonical_legal_entity(uuid) SECURITY DEFINER;
ALTER FUNCTION resolution.canonical_legal_entity(uuid)
  SET search_path = pg_catalog, resolution, identity, pg_temp;

ALTER FUNCTION resolution.legal_entities_with_canonical(uuid) SECURITY DEFINER;
ALTER FUNCTION resolution.legal_entities_with_canonical(uuid)
  SET search_path = pg_catalog, resolution, identity, pg_temp;

REVOKE ALL ON FUNCTION resolution.approved_consolidation_target(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolution.canonical_legal_entity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolution.legal_entities_with_canonical(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION resolution.approved_consolidation_target(uuid)
  TO bdc_reader, resolution_writer, admin_reader, CURRENT_USER;
GRANT EXECUTE ON FUNCTION resolution.canonical_legal_entity(uuid)
  TO bdc_reader, resolution_writer, admin_reader, CURRENT_USER;
GRANT EXECUTE ON FUNCTION resolution.legal_entities_with_canonical(uuid)
  TO bdc_reader, resolution_writer, admin_reader, CURRENT_USER;
