// Industry and Type cells on the one HTML row that already cites a bound context.
// The context id locates that row. Column identity is the heading text on the
// same slot. An empty Industry cell stays empty. Identifier text is not read.

import { cellText } from "../parse/schedule-disclosure-block.mjs";
import { tableRows } from "../normalize/ix-context-row.mjs";

export const BOUND_CONTEXT_RESEARCH_CODE = "obs.research_field.bound_context_cell";
export const BOUND_CONTEXT_RESEARCH_VERSION = "3";

const INDUSTRY_LABELS = new Set(["Industry"]);
const TYPE_LABELS = new Set(["Type", "Type of Investment"]);

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

function styleOf(raw) {
  const match = raw.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  return match?.[2] ?? match?.[3] ?? "";
}

function footnoteToken(text) {
  const trimmed = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return trimmed !== "" && /\d/.test(trimmed) && /^[\d,() ]+$/.test(trimmed);
}

// EDGAR renders these markers as a raised span, not a <sup> element.
// Only a marker whose whole text is a footnote token is removed.
function isFootnoteMarker(tag, body) {
  if (!footnoteToken(cellText(body))) return false;
  if (tag.name === "sup") return true;
  if (tag.name !== "span") return false;
  const style = styleOf(tag.raw);
  return /position\s*:\s*relative/i.test(style) && /(?:^|;)\s*top\s*:\s*-/i.test(style);
}

function withoutFootnoteMarkers(inner) {
  let out = "";
  let index = 0;
  while (index < inner.length) {
    if (inner[index] !== "<") {
      const next = inner.indexOf("<", index);
      out += next < 0 ? inner.slice(index) : inner.slice(index, next);
      index = next < 0 ? inner.length : next;
      continue;
    }
    const tag = tagAt(inner, index);
    if (!tag || tag.malformed) return inner;
    if (!tag.closing && !tag.selfClosing && (tag.name === "span" || tag.name === "sup")) {
      const close = closeTagAt(inner, tag.end, tag.name);
      if (typeof close === "number" && close >= 0) {
        const endTag = tagAt(inner, close);
        if (endTag && isFootnoteMarker(tag, inner.slice(tag.end, close))) {
          index = endTag.end;
          continue;
        }
      }
    }
    out += inner[index];
    index += 1;
  }
  return out;
}

function matchedText(inner) {
  return cellText(withoutFootnoteMarkers(inner.replace(/<br\s*\/?>/gi, " ")))
    .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function gridOf(rowHtml) {
  const openEnd = rowHtml.indexOf(">");
  const closeAt = rowHtml.toLowerCase().lastIndexOf("</tr>");
  if (openEnd < 0 || closeAt < openEnd) return null;
  const inner = rowHtml.slice(openEnd + 1, closeAt);
  const cells = [];
  let index = 0;
  while (index < inner.length) {
    const start = inner.indexOf("<", index);
    if (start < 0) break;
    const tag = tagAt(inner, start);
    if (!tag || tag.malformed || (!tag.closing && tag.name === "table")) return null;
    if (!tag.closing && (tag.name === "td" || tag.name === "th")) {
      let cellInner = "";
      let next = tag.end;
      if (!tag.selfClosing) {
        const close = closeTagAt(inner, tag.end, tag.name);
        if (!close || close.nested || typeof close !== "number" || close < 0) return null;
        cellInner = inner.slice(tag.end, close);
        if (/<table\b/i.test(cellInner)) return null;
        next = tagAt(inner, close).end;
      }
      cells.push({
        slot: 0,
        colspan: colspanOf(tag.raw),
        rawText: cellText(withoutFootnoteMarkers(cellInner)),
        matchedText: matchedText(cellInner),
        tagged: /<ix:/i.test(cellInner),
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
  return cells;
}

function locatedRows(html) {
  const rows = [];
  let from = 0;
  while (from < html.length) {
    const start = html.indexOf("<tr", from);
    if (start < 0) break;
    const next = html[start + 3];
    if (next !== ">" && next !== " " && next !== "\n" && next !== "\t" && next !== "/") {
      from = start + 3;
      continue;
    }
    const end = html.indexOf("</tr>", start);
    if (end < 0) break;
    rows.push({ html: html.slice(start, end + "</tr>".length), start });
    from = end + "</tr>".length;
  }
  const official = tableRows(html);
  if (rows.length !== official.length || rows.some((row, index) => row.html !== official[index])) return null;
  return rows;
}

function citesContext(rowHtml, contextId) {
  const pattern = /contextRef\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of rowHtml.matchAll(pattern)) {
    if ((match[2] ?? match[3]) === contextId) return true;
  }
  return false;
}

function headingFor(rows, grids, tableStart, rowIndex, labels) {
  const found = [];
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    if (rows[index].start < tableStart) break;
    const hits = (grids[index] ?? []).filter((cell) => !cell.tagged && labels.has(cell.matchedText));
    if (hits.length > 1) return { ambiguous: true };
    if (hits.length === 1) found.push({ index, cell: hits[0] });
  }
  if (found.length === 0) return null;
  return found[0];
}

function valueAt(cells, slot) {
  return cells.find((cell) => cell.slot === slot) ?? null;
}

export function researchHeadAction(heads, rawText) {
  if (!Array.isArray(heads) || heads.length > 1) return "CONFLICT";
  if (heads.length === 0) return "INSERT";
  const head = heads[0];
  if (head?.rawValue === rawText && head?.normalizedText === rawText && head?.valueState === "REPORTED") return "KEEP";
  return "CONFLICT";
}

function fieldFrom(fieldCode, value, rowIndex, heading) {
  return {
    fieldCode,
    rawText: value.rawText,
    rowOrdinal: rowIndex + 1,
    slotOrdinal: value.slot,
    heading: {
      rowOrdinal: heading.index + 1,
      slotOrdinal: heading.cell.slot,
      rawText: heading.cell.rawText,
      matchedText: heading.cell.matchedText,
    },
  };
}

// Null means this row has no untagged Type cell under an Industry heading.
// An empty Industry cell is left absent. Another row is never consulted.
export function boundContextResearchCells(html, contextId) {
  if (typeof html !== "string" || typeof contextId !== "string" || contextId === "") return null;
  const rows = locatedRows(html);
  if (!rows) return null;
  const hits = rows.flatMap((row, index) => (citesContext(row.html, contextId) ? [index] : []));
  if (hits.length !== 1) return null;
  const rowIndex = hits[0];
  const tableStart = html.lastIndexOf("<table", rows[rowIndex].start);
  if (tableStart < 0) return null;
  const grids = rows.map((row) => gridOf(row.html));
  const valueCells = grids[rowIndex];
  if (!valueCells) return null;
  const industryHeading = headingFor(rows, grids, tableStart, rowIndex, INDUSTRY_LABELS);
  const typeHeading = headingFor(rows, grids, tableStart, rowIndex, TYPE_LABELS);
  if (!industryHeading || industryHeading.ambiguous) return null;
  if (!typeHeading || typeHeading.ambiguous) return null;
  const typeValue = valueAt(valueCells, typeHeading.cell.slot);
  if (!typeValue || typeValue.tagged || typeValue.rawText === "") return null;
  const fields = [];
  const industryValue = valueAt(valueCells, industryHeading.cell.slot);
  if (industryValue?.tagged) return null;
  if (industryValue && industryValue.rawText !== "") {
    fields.push(fieldFrom("INDUSTRY", industryValue, rowIndex, industryHeading));
  }
  fields.push(fieldFrom("INSTRUMENT_TYPE", typeValue, rowIndex, typeHeading));
  fields.sort((left, right) => left.fieldCode.localeCompare(right.fieldCode));
  return { contextId, rowOrdinal: rowIndex + 1, fields };
}
