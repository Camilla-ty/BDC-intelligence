// Read-only loader for norm.instrument_type_footnote_ref v1. For each INSTRUMENT_TYPE field value it
// reads the stored filing document named by that value's own evidence and verifies the trailing
// marker run on the recorded table row. Writes nothing. A document that cannot be read with its
// recorded sha256 fails closed (UNVERIFIED, text unchanged).

import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import {
  HTML_TYPE_SOURCE_RULES, documentUnavailable, notApplicable, verifyTypeFootnoteRefs,
} from "../normalize/instrument-type-footnote-ref.mjs";

function fieldValueIds(ids) {
  const out = new Set();
  for (const raw of ids ?? []) {
    if (raw == null) continue;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid position_field_value id: ${raw}`);
    out.add(id);
  }
  return [...out];
}

function loadTypeSources(database, ids) {
  const rows = queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'field_value_id', fv.id,
  'field_code', fv.field_code,
  'raw_value', fv.raw_value,
  'rule_code', rv.rule_code,
  'locator_type', e.locator_type,
  'html_row_ordinal', e.html_row_ordinal,
  'storage_key', a.storage_key,
  'sha256', a.sha256
) ORDER BY fv.id), '[]'::json)
FROM obs.position_field_value fv
JOIN ops.rule_version rv ON rv.id = fv.normalization_rule_version_id
JOIN evidence.evidence e ON e.id = fv.evidence_id
LEFT JOIN raw.artifact a ON a.id = e.artifact_id
WHERE fv.id IN (${ids.join(",")});`);
  return rows.length === 0 ? [] : JSON.parse(rows[0][0]);
}

// Returns Map(field_value_id -> footnote-ref result). Values outside an HTML disclosure cell are
// NOT_APPLICABLE and keep their raw text.
export function loadTypeFootnoteRefs(database, typeFieldValueIds, { dataDir = DEFAULT_DATA_DIR } = {}) {
  const ids = fieldValueIds(typeFieldValueIds);
  const out = new Map();
  if (ids.length === 0) return out;
  const store = createStore(dataDir);
  const documents = new Map();
  const documentFor = (key, sha) => {
    const cacheKey = `${key}\u0000${sha}`;
    if (!documents.has(cacheKey)) {
      let html = null;
      try {
        html = store.read(key, sha).toString("utf8");
      } catch {
        html = null;
      }
      documents.set(cacheKey, html);
    }
    return documents.get(cacheKey);
  };

  for (const row of loadTypeSources(database, ids)) {
    if (row.field_code !== "INSTRUMENT_TYPE") throw new Error(`field value ${row.field_value_id} is not INSTRUMENT_TYPE`);
    const fromHtmlCell = HTML_TYPE_SOURCE_RULES.includes(row.rule_code) && row.locator_type === "HTML_TABLE_CELL";
    let ref;
    if (!fromHtmlCell || row.raw_value == null) {
      ref = notApplicable(row.raw_value);
    } else {
      const html = row.storage_key && row.sha256 ? documentFor(row.storage_key, row.sha256) : null;
      ref = html == null
        ? documentUnavailable(row.raw_value)
        : verifyTypeFootnoteRefs({ html, rowOrdinal: Number(row.html_row_ordinal), rawText: row.raw_value });
    }
    out.set(Number(row.field_value_id), { ...ref, fieldValueId: Number(row.field_value_id), sourceRule: row.rule_code });
  }
  for (const id of ids) {
    if (!out.has(id)) throw new Error(`INSTRUMENT_TYPE field value ${id} was not found`);
  }
  return out;
}
