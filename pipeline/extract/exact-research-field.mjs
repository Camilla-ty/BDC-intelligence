// Exact-bind research cells on a parser v2 disclosure block.
// This module does not parse a new layout and does not change parser v2.
// It reads parseScheduleDisclosureBlocks output and keeps only a detail row whose
// iXBRL identifier domain equals holding_descriptor_raw and whose context period
// end equals reported_date. Neither comparison trims.

import { parseScheduleDisclosureBlocks } from "../parse/schedule-disclosure-block.mjs";

export const RESEARCH_FIELD_CODE = "obs.research_field.exact_disclosure_cell";
export const RESEARCH_FIELD_VERSION = "1";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return null;
  return match[2] ?? match[3];
}

// Same period rule as ix-context-row contextPeriodEnds: instant, else endDate,
// ISO dates only, and a repeated context id has no period end. Duplicated here
// so this rule does not edit that file or parser v2.
function contextPeriodEnds(html) {
  const ends = new Map();
  const seen = new Set();
  for (const match of html.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g)) {
    const id = attr(match[1], "id");
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

function cellTextAt(row, slot) {
  const cell = row.cells.find((item) => item.slot === slot);
  return cell ? cell.text : "";
}

export function selectExactResearchFields({ html, holdingDescriptorRaw, reportedDate }) {
  if (typeof html !== "string") throw new Error("filing HTML is required");
  if (typeof holdingDescriptorRaw !== "string" || holdingDescriptorRaw === "") {
    throw new Error("holding_descriptor_raw is required");
  }
  if (typeof reportedDate !== "string" || !ISO_DATE.test(reportedDate)) {
    throw new Error("reported_date must be YYYY-MM-DD");
  }
  const parsed = parseScheduleDisclosureBlocks(html);
  const periods = contextPeriodEnds(html);
  const matches = [];
  for (const block of parsed.blocks) {
    if (block.parserVersion !== "2") continue;
    for (const row of block.rows) {
      for (const line of row.lines) {
        if (line.domain === holdingDescriptorRaw && periods.get(line.contextId) === reportedDate) {
          matches.push({ block, row });
        }
      }
    }
  }
  const distinct = new Map();
  for (const match of matches) {
    distinct.set(`${match.block.startRowOrdinal}:${match.block.endRowOrdinal}:${match.row.rowOrdinal}`, match);
  }
  if (distinct.size === 0) return { block: null, fields: [] };
  if (distinct.size > 1) throw new Error("exact research bind matched more than one detail row");
  const { block, row } = distinct.values().next().value;
  const industry = cellTextAt(row, block.portfolioCompanySlot);
  const instrument = cellTextAt(row, block.typeSlot);
  const fields = [];
  if (industry !== "") {
    fields.push({
      fieldCode: "INDUSTRY",
      rawText: industry,
      htmlRowOrdinal: row.rowOrdinal,
      htmlSlotOrdinal: block.portfolioCompanySlot,
    });
  }
  if (instrument !== "") {
    fields.push({
      fieldCode: "INSTRUMENT_TYPE",
      rawText: instrument,
      htmlRowOrdinal: row.rowOrdinal,
      htmlSlotOrdinal: block.typeSlot,
    });
  }
  return {
    block: {
      startRowOrdinal: block.startRowOrdinal,
      endRowOrdinal: block.endRowOrdinal,
      portfolioCompanySlot: block.portfolioCompanySlot,
      typeSlot: block.typeSlot,
    },
    fields,
  };
}
