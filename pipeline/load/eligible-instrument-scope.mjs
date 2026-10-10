// Observations the existing P4, P6, and P7 rules can already accept.
// Eligibility is stored identifier text plus a reported instrument type.
// The bounded subset is deterministic. It does not name a borrower or a registrant.

import { queryRows } from "../lib/db.mjs";

export function selectBoundedEligibleObservations(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const series = multiPeriodSeries(list.filter((row) => row.registrantLinkStatus === "LINKED"));
  series.sort((left, right) => left.minId - right.minId || left.identifierRaw.localeCompare(right.identifierRaw) || left.instrumentType.localeCompare(right.instrumentType));
  const chosen = new Map();
  if (series.length > 0) addGroup(chosen, series[0].rows);
  const html = list.filter((row) => row.typeLocator === "HTML_TABLE_CELL").sort((left, right) => left.id - right.id);
  for (const row of html) chosen.set(row.id, row);
  return [...chosen.values()].sort((left, right) => left.id - right.id);
}

function addGroup(chosen, rows) {
  for (const row of rows) chosen.set(row.id, row);
}

// One observation per reporting date for one registrant, exact identifier, and exact type.
// A repeated date stays out. The match rule is unchanged; this only chooses what may run.
export function selectUniqueDateEligibleObservations(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  for (const row of list) {
    if (row.registrantLinkStatus !== "LINKED") continue;
    if (row.registrantId == null || row.reportedDate == null || row.reportedDate === "") continue;
    if (typeof row.identifierRaw !== "string" || row.identifierRaw === "") continue;
    if (typeof row.instrumentType !== "string" || row.instrumentType === "") continue;
    const key = `${row.registrantId}\u0000${row.identifierRaw}\u0000${row.instrumentType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const chosen = [];
  for (const group of groups.values()) {
    const dates = group.map((row) => row.reportedDate);
    if (new Set(dates).size !== group.length) continue;
    chosen.push(...group);
  }
  return chosen.sort((left, right) => left.id - right.id);
}

export function planUniqueDateBatches(rows, { alreadyDecidedIds = [], limit = null } = {}) {
  const decided = new Set((alreadyDecidedIds ?? []).map((id) => Number(id)));
  const groups = new Map();
  for (const row of selectUniqueDateEligibleObservations(rows)) {
    if (!groups.has(row.identifierRaw)) groups.set(row.identifierRaw, []);
    groups.get(row.identifierRaw).push(row);
  }
  const pending = [...groups.values()]
    .map((group) => [...group].sort((left, right) => left.id - right.id))
    .filter((group) => group.some((row) => !decided.has(row.id)));
  pending.sort((left, right) => left[0].id - right[0].id || left[0].identifierRaw.localeCompare(right[0].identifierRaw));
  if (limit == null) return pending;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("unique-date batch limit must be a positive integer");
  }
  return pending.slice(0, limit);
}

function multiPeriodSeries(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.registrantId == null || row.reportedDate == null || row.reportedDate === "") continue;
    const key = `${row.registrantId}\u0000${row.identifierRaw}\u0000${row.instrumentType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const series = [];
  for (const group of groups.values()) {
    const dates = new Set(group.map((row) => row.reportedDate));
    if (dates.size < 2 || dates.size !== group.length) continue;
    series.push({
      minId: Math.min(...group.map((row) => row.id)),
      identifierRaw: group[0].identifierRaw,
      instrumentType: group[0].instrumentType,
      rows: group,
    });
  }
  return series;
}

export function loadEligibleInstrumentObservations(database) {
  const rows = queryRows(database, `
SELECT coalesce(json_agg(row_json ORDER BY id), '[]'::json)::text
FROM (
  SELECT DISTINCT ON (p.id)
         p.id,
         json_build_object(
           'id', p.id,
           'identifierRaw', s.identifier_raw,
           'instrumentType', btrim(fv.raw_value),
           'reportedDate', p.reported_date::text,
           'registrantId', fr.registrant_id,
           'registrantLinkStatus', fr.registrant_link_status,
           'typeLocator', e.locator_type::text
         ) AS row_json
  FROM obs.current_position_field_value fv
  JOIN evidence.evidence e ON e.id = fv.evidence_id
  JOIN obs.position_observation p ON p.id = fv.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = s.tabular_row_id
  JOIN raw.table_load tl ON tl.id = r.table_load_id
  LEFT JOIN LATERAL (
    SELECT fr.registrant_id, fr.registrant_link_status
    FROM registry.current_filing_registrant fr
    WHERE fr.filing_id = p.filing_id
    ORDER BY CASE WHEN fr.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, fr.registrant_id
    LIMIT 1
  ) fr ON true
  WHERE fv.field_code = 'INSTRUMENT_TYPE'
    AND fv.value_state = 'REPORTED'
    AND coalesce(btrim(fv.raw_value), '') <> ''
    AND s.identifier_raw IS NOT NULL
    AND btrim(s.identifier_raw) <> ''
    AND array_position(tl.header, 'Investment, Identifier Axis') IS NOT NULL
    AND r.cells[array_position(tl.header, 'Investment, Identifier Axis')] IS NOT DISTINCT FROM s.identifier_raw
  ORDER BY p.id, fv.id
) eligible;`);
  const parsed = JSON.parse(rows[0][0]);
  return parsed.map((row) => ({
    id: Number(row.id),
    identifierRaw: row.identifierRaw,
    instrumentType: row.instrumentType,
    reportedDate: row.reportedDate,
    registrantId: row.registrantId == null ? null : Number(row.registrantId),
    registrantLinkStatus: row.registrantLinkStatus,
    typeLocator: row.typeLocator,
  }));
}
