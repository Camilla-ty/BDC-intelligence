// SOI fact groups. One position observation stays one identifier-bearing fact row.
// A group is created only for two shapes:
//   one balance fact and one spread fact
//   those two plus one PIK-only fact
// Shared context is registrant, filing, reporting date, exact identifier text,
// and exact Investment Type Axis text. Debt, class of stock, equity components,
// and range must agree when both are populated. A blank axis is not a wildcard.
// Amounts, dates, rates, row order, and line number are not identity keys.

export const SOI_FACT_GROUP_RULE = {
  code: "obs.soi_fact_group",
  version: "1",
};

export const AXIS_LABELS = {
  debt: "Debt Instrument Axis",
  stock: "Class of Stock Axis",
  equity: "Equity Components Axis",
  range: "Range Axis",
  type: "Investment Type Axis",
};

const DIMENSION_FIELDS = new Set([
  "INDUSTRY",
  "INSTRUMENT_TYPE",
  "ISSUER_AFFILIATION",
  "ISSUER_NAME",
  "GEOGRAPHY",
  "SENIORITY",
  "NON_ACCRUAL",
  "RESTRICTED",
  "FAIR_VALUE_LEVEL",
  "REFERENCE_RATE",
  "SECURED",
]);

// Balance-side fields already mapped from SOI. Presence of one of these does not
// identify the group. A field outside this set, or a spread on the same row, has no role.
const BALANCE_MEASURES = new Set([
  "PRINCIPAL_AMOUNT",
  "FAIR_VALUE",
  "COST",
  "MATURITY_DATE",
  "ACQUISITION_DATE",
  "INTEREST_RATE",
  "INTEREST_RATE_FLOOR",
  "PIK_RATE",
  "CASH_RATE",
  "PERCENT_OF_NET_ASSETS",
]);

const ROLE_EVIDENCE_FIELD = {
  BALANCE: "PRINCIPAL_AMOUNT",
  SPREAD: "SPREAD",
  PIK: "PIK_RATE",
};

const ROLE_ORDER = { BALANCE: 0, SPREAD: 1, PIK: 2 };

export function axisText(value) {
  if (value == null) return "";
  const text = String(value);
  return text.trim() === "" ? "" : text;
}

export function classifyFactRole(fieldCodes) {
  const measures = [];
  for (const code of fieldCodes) {
    if (!DIMENSION_FIELDS.has(code)) measures.push(code);
  }
  if (new Set(measures).size !== measures.length) return null;
  const set = new Set(measures);
  const balance = set.has("PRINCIPAL_AMOUNT")
    && set.has("FAIR_VALUE")
    && !set.has("SPREAD")
    && [...set].every((code) => BALANCE_MEASURES.has(code));
  const spread = set.size === 1 && set.has("SPREAD");
  const pik = set.size === 1 && set.has("PIK_RATE");
  if (balance && !spread && !pik) return "BALANCE";
  if (spread && !balance && !pik) return "SPREAD";
  if (pik && !balance && !spread) return "PIK";
  return null;
}

export function selectDuplicateDatePopulation(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.registrantLinkStatus !== "LINKED" || row.registrantId == null) continue;
    if (typeof row.identifierRaw !== "string" || row.identifierRaw === "") continue;
    if (typeof row.instrumentType !== "string" || row.instrumentType === "") continue;
    if (typeof row.reportedDate !== "string" || row.reportedDate === "") continue;
    const key = `${row.registrantId}\u0000${row.identifierRaw}\u0000${row.instrumentType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const kept = [];
  for (const group of groups.values()) {
    const dates = new Set(group.map((row) => row.reportedDate));
    if (dates.size !== group.length) kept.push(...group);
  }
  kept.sort((left, right) => left.id - right.id);
  return kept;
}

function isComplete(row) {
  return Number.isSafeInteger(row.id)
    && Number.isSafeInteger(row.filingId)
    && Number.isSafeInteger(row.registrantId)
    && typeof row.reportedDate === "string"
    && row.reportedDate !== ""
    && typeof row.identifierRaw === "string"
    && row.identifierRaw !== ""
    && typeof row.instrumentType === "string"
    && row.instrumentType !== ""
    && row.axes
    && Array.isArray(row.fieldCodes);
}

function dateKey(row) {
  return [row.registrantId, row.reportedDate, row.identifierRaw, row.instrumentType].join("\u0000");
}

function partitionKey(row) {
  return [
    row.filingId,
    row.registrantId,
    row.reportedDate,
    row.identifierRaw,
    row.instrumentType,
    row.axes.debt,
    row.axes.stock,
    row.axes.equity,
    row.axes.range,
  ].join("\u0000");
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function measuresOverlap(rows) {
  const seen = new Set();
  for (const row of rows) {
    for (const code of row.fieldCodes) {
      if (DIMENSION_FIELDS.has(code)) continue;
      if (seen.has(code)) return true;
      seen.add(code);
    }
  }
  return false;
}

function prepared(row) {
  const role = classifyFactRole(row.fieldCodes);
  const evidenceField = role ? ROLE_EVIDENCE_FIELD[role] : null;
  const evidenceId = evidenceField ? row.evidenceByField?.[evidenceField] : null;
  return {
    row,
    role: Number.isSafeInteger(evidenceId) ? role : null,
    evidenceId: Number.isSafeInteger(evidenceId) ? evidenceId : null,
  };
}

function roleCountsMatch(preparedRows) {
  if (preparedRows.some((item) => item.role == null)) return false;
  const balance = preparedRows.filter((item) => item.role === "BALANCE").length;
  const spread = preparedRows.filter((item) => item.role === "SPREAD").length;
  const pik = preparedRows.filter((item) => item.role === "PIK").length;
  return balance === 1 && spread === 1 && pik <= 1 && preparedRows.length === balance + spread + pik;
}

function tryPartition(part) {
  const items = part.map(prepared);
  if (!roleCountsMatch(items)) return { group: null, reason: "shape" };
  if (measuresOverlap(part)) return { group: null, reason: "overlap" };
  const members = items
    .map((item) => ({
      positionObservationId: item.row.id,
      role: item.role,
      evidenceId: item.evidenceId,
    }))
    .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.positionObservationId - right.positionObservationId);
  const pik = members.some((member) => member.role === "PIK");
  const ids = members.map((member) => member.positionObservationId).sort((left, right) => left - right);
  return {
    group: {
      filingId: part[0].filingId,
      state: "UNRESOLVED",
      shape: pik ? "BALANCE_SPREAD_PIK" : "BALANCE_SPREAD",
      rationale: pik
        ? "SOI fact group v1: one balance fact, one spread fact, and one PIK-only fact share registrant, filing, date, identifier, type, and axis members. This is not an instrument, position, or transaction."
        : "SOI fact group v1: one balance fact and one spread fact share registrant, filing, date, identifier, type, and axis members. This is not an instrument, position, or transaction.",
      groupingKey: `v1:${ids.join(",")}`,
      members,
    },
    reason: null,
  };
}

export function planFactGroups(rows) {
  const valid = [];
  for (const row of rows) {
    if (!isComplete(row)) continue;
    const instrumentType = axisText(row.instrumentType);
    if (instrumentType === "") continue;
    valid.push({
      ...row,
      axes: {
        debt: axisText(row.axes.debt),
        stock: axisText(row.axes.stock),
        equity: axisText(row.axes.equity),
        range: axisText(row.axes.range),
      },
      instrumentType,
      fieldCodes: [...row.fieldCodes],
    });
  }
  const dateGroups = groupBy(valid, dateKey);
  const groups = [];
  const blocked = { axisOrFiling: 0, overlap: 0, roleShape: 0 };
  let nRejectedDateGroups = 0;
  for (const dateRows of dateGroups.values()) {
    const partitions = groupBy(dateRows, partitionKey);
    const created = [];
    for (const part of partitions.values()) {
      const planned = tryPartition(part);
      if (planned.group) created.push(planned.group);
    }
    if (created.length === 0) {
      nRejectedDateGroups += 1;
      const items = dateRows.map(prepared);
      if (roleCountsMatch(items) && measuresOverlap(dateRows)) blocked.overlap += 1;
      else if (roleCountsMatch(items)) blocked.axisOrFiling += 1;
      else blocked.roleShape += 1;
    }
    groups.push(...created);
  }
  groups.sort((left, right) => left.groupingKey.localeCompare(right.groupingKey));
  return {
    groups,
    nDateGroups: dateGroups.size,
    nRejectedDateGroups,
    blocked,
  };
}

export function groupsToInsert(groups, existingKeys) {
  const seen = new Set(existingKeys);
  const pending = [];
  for (const group of groups) {
    if (seen.has(group.groupingKey)) continue;
    pending.push(group);
    seen.add(group.groupingKey);
  }
  return pending;
}
