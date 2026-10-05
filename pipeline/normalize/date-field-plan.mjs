// Dry-run planner for one verified date binding.
// The caller supplies the observation, artifact, row, slot, and heading coordinates.
// This module reads those cells and applies norm.date_heading. It does not scan for a
// borrower, does not trim an identifier, and does not write a database row.

import { cellText } from "../parse/schedule-disclosure-block.mjs";
import { tableRows } from "./ix-context-row.mjs";
import { acceptDateCell, normalizeDisclosedDate } from "./date-heading.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_SHAPED = /^(?:\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4})$/;

function reject(reason, observationId = null) {
  return {
    accepted: false,
    reason,
    observationId,
    fields: [],
    headings: [],
  };
}

function tagAt(html, index) {
  if (html[index] !== "<") return null;
  const end = html.indexOf(">", index);
  if (end < 0) return { malformed: true, end: html.length };
  const raw = html.slice(index, end + 1);
  const match = /^<\/?([A-Za-z][A-Za-z0-9:]*)/.exec(raw);
  return {
    name: match ? match[1].toLowerCase() : null,
    closing: raw.startsWith("</"),
    selfClosing: /\/\s*>$/.test(raw),
    raw,
    end: end + 1,
  };
}

function colspanOf(raw) {
  const match = raw.match(/\bcolspan\s*=\s*("(\d+)"|'(\d+)')/i);
  const value = Number(match?.[2] ?? match?.[3] ?? 1);
  return value >= 1 ? value : 1;
}

function closeTagAt(html, from, name) {
  let index = from;
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start < 0) return -1;
    const tag = tagAt(html, start);
    if (!tag || tag.malformed) return -1;
    if (!tag.closing && tag.name === "table") return { nested: true };
    if (!tag.closing && (tag.name === "td" || tag.name === "th")) return -1;
    if (tag.closing && tag.name === name) return start;
    index = tag.end;
  }
  return -1;
}

function headerLabel(label) {
  return label.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function labelText(inner) {
  return cellText(inner.replace(/<br\s*\/?>/gi, " "));
}

function gridOf(rowHtml) {
  const openEnd = rowHtml.indexOf(">");
  const closeAt = rowHtml.toLowerCase().lastIndexOf("</tr>");
  if (openEnd < 0 || closeAt < openEnd) return { refused: true };
  const inner = rowHtml.slice(openEnd + 1, closeAt);
  const cells = [];
  let index = 0;
  while (index < inner.length) {
    const start = inner.indexOf("<", index);
    if (start < 0) break;
    const tag = tagAt(inner, start);
    if (!tag || tag.malformed) return { refused: true };
    if (!tag.closing && tag.name === "table") return { refused: true };
    if (!tag.closing && (tag.name === "td" || tag.name === "th")) {
      let cellInner = "";
      let next = tag.end;
      if (!tag.selfClosing) {
        const close = closeTagAt(inner, tag.end, tag.name);
        if (close && close.nested) return { refused: true };
        if (typeof close !== "number" || close < 0) return { refused: true };
        cellInner = inner.slice(tag.end, close);
        if (/<table\b/i.test(cellInner)) return { refused: true };
        next = tagAt(inner, close).end;
      }
      const colspan = colspanOf(tag.raw);
      cells.push({
        colspan,
        rawText: cellText(cellInner),
        matchedText: headerLabel(labelText(cellInner)),
      });
      index = next;
      continue;
    }
    index = tag.end;
  }
  let slot = 0;
  for (const cell of cells) {
    cell.slot = slot;
    slot += cell.colspan;
  }
  return { refused: false, cells };
}

function contextPeriodEnds(html) {
  const ends = new Map();
  const seen = new Set();
  for (const match of html.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g)) {
    const id = match[1].match(/\bid\s*=\s*"([^"]*)"/)?.[1];
    if (!id) continue;
    if (seen.has(id)) {
      ends.set(id, null);
      continue;
    }
    seen.add(id);
    const instant = match[2].match(/<xbrli:instant>\s*([^<]*?)\s*<\/xbrli:instant>/);
    const endDate = match[2].match(/<xbrli:endDate>\s*([^<]*?)\s*<\/xbrli:endDate>/);
    const raw = instant ? instant[1] : endDate ? endDate[1] : null;
    ends.set(id, raw && ISO_DATE.test(raw) ? raw : null);
  }
  return ends;
}

export function indexFilingRows(html) {
  if (typeof html !== "string") throw new Error("filing HTML is required");
  const rows = tableRows(html).map((rowHtml, index) => ({
    rowOrdinal: index + 1,
    rowHtml,
    grid: gridOf(rowHtml),
  }));
  return { rows, periods: contextPeriodEnds(html) };
}

function cellAt(indexed, rowOrdinal, slotOrdinal) {
  const row = indexed.rows[rowOrdinal - 1];
  if (!row || row.grid.refused) return null;
  return row.grid.cells.find((cell) => cell.slot === slotOrdinal) ?? null;
}

function valueCell(indexed, rowOrdinal, slotOrdinal) {
  const row = indexed.rows[rowOrdinal - 1];
  if (!row || row.grid.refused) return { reason: "wrong value row" };
  const cell = row.grid.cells.find((item) => item.slot === slotOrdinal);
  if (!cell) return { reason: "wrong slot" };
  return { cell };
}

function rowPeriod(indexed, rowOrdinal) {
  const row = indexed.rows[rowOrdinal - 1];
  if (!row) return { accepted: false, reason: "missing period evidence" };
  const ids = [...row.rowHtml.matchAll(/\bcontextRef\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { accepted: false, reason: "missing period evidence" };
  const values = unique.map((id) => indexed.periods.get(id) ?? null);
  if (values.some((value) => value == null) || new Set(values).size !== 1) {
    return { accepted: false, reason: "ambiguous period" };
  }
  return { accepted: true, period: values[0] };
}

function positive(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function slotOrdinal(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function storageFor(normalized) {
  if (normalized.precision === "MONTH") {
    return {
      precision: "MONTH",
      datePrecision: "MONTH",
      normalizedYear: normalized.year,
      normalizedMonth: normalized.month,
      normalizedDate: null,
    };
  }
  return {
    precision: "DAY",
    datePrecision: null,
    normalizedYear: null,
    normalizedMonth: null,
    normalizedDate: normalized.normalizedDate,
  };
}

function storageConflict(storage, requested) {
  if (!requested) return null;
  if (storage.precision === "MONTH" && requested.normalizedDate != null) return "month/year converted to a day";
  if (storage.precision === "DAY" && requested.precision === "MONTH") return "day value cannot be stored as MONTH";
  if (requested.precision != null && requested.precision !== storage.precision) return "requested precision does not match the disclosed date";
  if (requested.normalizedDate !== undefined && requested.normalizedDate !== storage.normalizedDate) {
    return "requested date does not match the disclosed date";
  }
  return null;
}

function planOne(binding, indexed) {
  const observationId = binding?.observationId ?? null;
  if (!positive(observationId)) return reject("observation id is required", observationId);
  if (!positive(binding.artifactId)) return reject("artifact id is required", observationId);
  if (typeof binding.reportedDate !== "string" || !ISO_DATE.test(binding.reportedDate)) {
    return reject("reported date is required", observationId);
  }
  if (!positive(binding.valueRow) || !slotOrdinal(binding.valueSlot)) return reject("value cell is required", observationId);
  if (typeof binding.rawDate !== "string" || binding.rawDate === "") return reject("raw date is required", observationId);
  if (!Array.isArray(binding.headings) || binding.headings.length === 0) return reject("missing heading", observationId);
  if (binding.headings.some((heading) => !positive(heading.row) || !slotOrdinal(heading.slot))) {
    return reject("missing heading", observationId);
  }
  if (binding.headings.some((heading) => heading.slot !== binding.valueSlot)) return reject("wrong slot", observationId);
  if (binding.headings.some((heading) => heading.row === binding.valueRow)) return reject("same-row heading", observationId);
  if (binding.headings.some((heading) => heading.row > binding.valueRow)) return reject("later heading", observationId);

  const located = valueCell(indexed, binding.valueRow, binding.valueSlot);
  if (located.reason) return reject(located.reason, observationId);
  const value = located.cell;
  if (value.rawText !== binding.rawDate) return reject("value cell text does not match", observationId);

  const headingCells = [];
  for (const heading of binding.headings) {
    const cell = cellAt(indexed, heading.row, heading.slot);
    if (!cell || cell.rawText.trim() === "") return reject("missing heading", observationId);
    if (DATE_SHAPED.test(cell.rawText)) return reject("sibling-row date copy", observationId);
    if (heading.matchedText !== cell.matchedText) return reject("heading text does not match", observationId);
    headingCells.push({
      artifactId: binding.artifactId,
      rowOrdinal: heading.row,
      slotOrdinal: heading.slot,
      rawText: cell.rawText,
      matchedText: cell.matchedText,
    });
  }

  const period = rowPeriod(indexed, binding.valueRow);
  if (!period.accepted) return reject(period.reason, observationId);
  if (period.period !== binding.reportedDate) return reject("cross-period", observationId);

  const decision = acceptDateCell(
    { artifactId: binding.artifactId, rowOrdinal: binding.valueRow, slotOrdinal: binding.valueSlot },
    headingCells,
  );
  if (!decision.accepted) {
    const labels = [...headingCells].sort((left, right) => left.rowOrdinal - right.rowOrdinal)
      .map((heading) => heading.matchedText);
    if (decision.reason === "ambiguous heading" && labels.length === 2 && labels[0] === "Maturity" && labels[1] === "Date") {
      return reject("ambiguous Maturity/Date stack", observationId);
    }
    return reject(decision.reason, observationId);
  }
  if (decision.fieldCode !== binding.expectedField) return reject("semantic field does not match the heading", observationId);

  const normalized = normalizeDisclosedDate(value.rawText);
  if (!normalized.accepted) return reject(normalized.reason, observationId);
  const storage = storageFor(normalized);
  const conflict = storageConflict(storage, binding.requestedStorage);
  if (conflict) return reject(conflict, observationId);

  const ordered = [...headingCells].sort((left, right) => left.rowOrdinal - right.rowOrdinal);
  const headingRecords = ordered.map((heading, index) => ({
    key: `${binding.artifactId}:${heading.rowOrdinal}:${heading.slotOrdinal}`,
    artifactId: binding.artifactId,
    rowOrdinal: heading.rowOrdinal,
    slotOrdinal: heading.slotOrdinal,
    rawText: heading.rawText,
    matchedText: heading.matchedText,
    stackAboveKey: index === 0 ? null : `${binding.artifactId}:${ordered[index - 1].rowOrdinal}:${ordered[index - 1].slotOrdinal}`,
  }));

  return {
    accepted: true,
    reason: null,
    observationId,
    fields: [{
      observationId,
      artifactId: binding.artifactId,
      reportedDate: binding.reportedDate,
      fieldCode: decision.fieldCode,
      rawValue: value.rawText,
      ...storage,
      valueRow: binding.valueRow,
      valueSlot: binding.valueSlot,
      headingKeys: headingRecords.map((heading) => heading.key),
    }],
    headings: headingRecords,
  };
}

function sameHeading(left, right) {
  return left.rawText === right.rawText
    && left.matchedText === right.matchedText
    && left.stackAboveKey === right.stackAboveKey
    && left.artifactId === right.artifactId;
}

export function planVerifiedDates(bindings, htmlByArtifact) {
  if (!Array.isArray(bindings)) return reject("missing heading");
  const indexed = new Map();
  const fields = [];
  const headings = new Map();
  const seenField = new Set();
  const seenCell = new Set();
  for (const binding of bindings) {
    const artifactId = binding?.artifactId;
    if (!positive(artifactId) || !htmlByArtifact?.has?.(artifactId)) return reject("wrong artifact", binding?.observationId ?? null);
    if (!indexed.has(artifactId)) indexed.set(artifactId, indexFilingRows(htmlByArtifact.get(artifactId)));
    const planned = planOne(binding, indexed.get(artifactId));
    if (!planned.accepted) return planned;
    const cellKey = `${planned.fields[0].artifactId}:${planned.fields[0].valueRow}:${planned.fields[0].valueSlot}`;
    if (seenCell.has(cellKey)) return reject("sibling-row date copy", planned.observationId);
    seenCell.add(cellKey);
    const fieldKey = `${planned.fields[0].observationId}:${planned.fields[0].fieldCode}`;
    if (seenField.has(fieldKey)) return reject("observation field is already planned", planned.observationId);
    seenField.add(fieldKey);
    fields.push(planned.fields[0]);
    for (const heading of planned.headings) {
      const existing = headings.get(heading.key);
      if (!existing) headings.set(heading.key, heading);
      else if (!sameHeading(existing, heading)) return reject("heading evidence conflict", planned.observationId);
    }
  }
  return { accepted: true, reason: null, observationId: null, fields, headings: [...headings.values()] };
}

// One already-planned stacked day maturity. The lower heading cites the upper
// heading. The value cell cites the lower heading. A day stays in normalized_date.
export function stackedDayMaturityWrite(plan) {
  if (!plan?.accepted || plan.fields?.length !== 1 || plan.headings?.length !== 2) {
    throw new Error("stacked day maturity requires one field and two headings");
  }
  const field = plan.fields[0];
  const normalized = normalizeDisclosedDate(field.rawValue);
  const ordered = [...plan.headings].sort((left, right) => left.rowOrdinal - right.rowOrdinal);
  const above = ordered[0];
  const below = ordered[1];
  if (field.fieldCode !== "MATURITY_DATE") throw new Error("only a maturity field is accepted");
  if (field.precision !== "DAY" || field.datePrecision != null) throw new Error("day precision must stay unset");
  if (field.normalizedYear != null || field.normalizedMonth != null) throw new Error("a day is not stored as a year and month");
  if (!normalized.accepted || normalized.precision !== "DAY" || normalized.normalizedDate !== field.normalizedDate) {
    throw new Error("raw day does not match the normalized day");
  }
  if (above.artifactId !== field.artifactId || below.artifactId !== field.artifactId) {
    throw new Error("heading from another artifact");
  }
  if (above.slotOrdinal !== field.valueSlot || below.slotOrdinal !== field.valueSlot) {
    throw new Error("heading slot differs");
  }
  if (above.stackAboveKey != null || below.stackAboveKey !== above.key) throw new Error("heading stack differs");
  if (above.matchedText !== "Maturity" || below.matchedText !== "Date") throw new Error("heading text differs");
  if (above.rawText == null || below.rawText == null || above.rawText === "" || below.rawText === "") {
    throw new Error("raw heading is required");
  }
  if (!(below.rowOrdinal > above.rowOrdinal) || !(field.valueRow > below.rowOrdinal)) {
    throw new Error("value row is not below the heading stack");
  }
  const headingKeys = new Set(field.headingKeys);
  if (headingKeys.size !== 2 || !headingKeys.has(above.key) || !headingKeys.has(below.key)) {
    throw new Error("value cell does not cite this heading stack");
  }
  return {
    headings: [above, below],
    cell: {
      artifactId: field.artifactId,
      rowOrdinal: field.valueRow,
      slotOrdinal: field.valueSlot,
      headingKey: below.key,
    },
    field: {
      observationId: field.observationId,
      fieldCode: "MATURITY_DATE",
      rawValue: field.rawValue,
      datePrecision: null,
      normalizedYear: null,
      normalizedMonth: null,
      normalizedDate: field.normalizedDate,
    },
  };
}

export function summarizeDatePlan(plan) {
  const fields = plan.fields ?? [];
  const headings = plan.headings ?? [];
  const citations = fields.reduce((sum, field) => sum + field.headingKeys.length, 0);
  return {
    accepted: plan.accepted,
    reason: plan.reason,
    fields: fields.length,
    acquisition: fields.filter((field) => field.fieldCode === "ACQUISITION_DATE").length,
    maturity: fields.filter((field) => field.fieldCode === "MATURITY_DATE").length,
    month: fields.filter((field) => field.precision === "MONTH").length,
    day: fields.filter((field) => field.precision === "DAY").length,
    nullNormalizedDate: fields.filter((field) => field.normalizedDate == null).length,
    dayNormalizedDate: fields.filter((field) => field.normalizedDate != null).map((field) => field.normalizedDate),
    valueCells: fields.length,
    headings: headings.length,
    headingCitations: citations,
    reusedHeadings: citations - headings.length,
  };
}
