// Schedule of Investments disclosure blocks, parser.sec_schedule_disclosure_block.
// Row ordinals are the 1-based document order of tableRows() in ix-context-row.mjs.
//
// Version 1 ends a block at the next company row or the next schedule header.
// That historical behavior includes section aggregate rows after the last company.
// parseScheduleDisclosureBlocksV1 preserves it.
//
// Version 2 is the ingestion parser. A row whose Portfolio Company slot is
// non-empty and whose Type of Investment slot is empty ends the previous block.
// An industry detail row stays inside because its Type of Investment slot is
// filled. A section banner is not emitted as a company block unless a
// type-bearing detail row follows it. Ingestion must use version 2.

import { decodeHtmlEntities } from "../normalize/filing-text.mjs";
import { tableRows } from "../normalize/ix-context-row.mjs";

export const PARSER_CODE = "parser.sec_schedule_disclosure_block";
export const PARSER_VERSION_V1 = "1";
export const PARSER_VERSION = "2";

export const ROW_KIND = {
  COMPANY: "company",
  INVESTMENT_LINE_WITH_IDENTIFIER: "INVESTMENT_LINE_WITH_IDENTIFIER",
  INVESTMENT_LINE_WITHOUT_IDENTIFIER: "INVESTMENT_LINE_WITHOUT_IDENTIFIER",
  TOTAL_OR_SUBTOTAL: "TOTAL_OR_SUBTOTAL",
  SECTION_BOUNDARY: "SECTION_BOUNDARY",
  SECTION_LABEL: "SECTION_LABEL",
  OTHER: "OTHER",
};

const FOOTNOTE = "(?: ?\\(\\d+\\))?";
const PORTFOLIO_HEADER = new RegExp(`^Portfolio Company, Location and Industry${FOOTNOTE}$`);
const TYPE_HEADER = new RegExp(`^Type of Investment${FOOTNOTE}$`);
const FAIR_VALUE_HEADER = new RegExp(`^Fair Value${FOOTNOTE}$`);

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return null;
  return match[2] ?? match[3];
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

// Markup whitespace between tags is omitted. A text node that contains a
// non-whitespace character is kept exactly, including its own spaces.
function labelText(inner) {
  return cellText(inner.replace(/<br\s*\/?>/gi, " "));
}

export function cellText(inner) {
  let out = "";
  let index = 0;
  while (index < inner.length) {
    if (inner[index] === "<") {
      const tag = tagAt(inner, index);
      if (!tag || tag.malformed) break;
      index = tag.end;
      continue;
    }
    const next = inner.indexOf("<", index);
    const text = next < 0 ? inner.slice(index) : inner.slice(index, next);
    index = next < 0 ? inner.length : next;
    const decoded = decodeHtmlEntities(text);
    if (!/\S/.test(decoded)) continue;
    out += decoded;
  }
  return out;
}

function factsIn(inner) {
  const facts = [];
  const pattern = /<ix:(nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:\1>/g;
  for (const match of inner.matchAll(pattern)) {
    facts.push({
      id: attr(match[2], "id"),
      name: attr(match[2], "name"),
      contextRef: attr(match[2], "contextRef"),
      text: cellText(match[3]),
    });
  }
  return facts;
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

function buildGrid(rowHtml) {
  const openEnd = rowHtml.indexOf(">");
  const closeAt = rowHtml.toLowerCase().lastIndexOf("</tr>");
  if (openEnd < 0 || closeAt < openEnd) return { refused: true, reason: "malformed row" };
  const inner = rowHtml.slice(openEnd + 1, closeAt);
  const cells = [];
  let index = 0;
  while (index < inner.length) {
    const start = inner.indexOf("<", index);
    if (start < 0) break;
    const tag = tagAt(inner, start);
    if (!tag || tag.malformed) return { refused: true, reason: "malformed tag" };
    if (!tag.closing && tag.name === "table") return { refused: true, reason: "nested table" };
    if (!tag.closing && (tag.name === "td" || tag.name === "th")) {
      let cellInner = "";
      let next = tag.end;
      if (!tag.selfClosing) {
        const close = closeTagAt(inner, tag.end, tag.name);
        if (close && close.nested) return { refused: true, reason: "nested table" };
        if (typeof close !== "number" || close < 0) return { refused: true, reason: "unclosed cell" };
        cellInner = inner.slice(tag.end, close);
        if (/<table\b/i.test(cellInner)) return { refused: true, reason: "nested table" };
        const closeTag = tagAt(inner, close);
        next = closeTag.end;
      }
      cells.push({
        colspan: colspanOf(tag.raw),
        text: cellText(cellInner),
        label: labelText(cellInner),
        facts: factsIn(cellInner),
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
  return { refused: false, cells, slotCount: slot };
}

function indexContexts(html) {
  const contexts = new Map();
  const pattern = /<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g;
  for (const match of html.matchAll(pattern)) {
    const id = attr(match[1], "id");
    if (!id || contexts.has(id)) continue;
    const typed = match[2].match(/<xbrldi:typedMember\b[^>]*dimension="us-gaap:InvestmentIdentifierAxis"[^>]*>([\s\S]*?)<\/xbrldi:typedMember>/);
    let domain = null;
    if (typed) {
      const element = typed[1].match(/<[^>]*InvestmentIdentifierAxis\.domain[^>]*>([\s\S]*?)<\/[^>]*>/);
      if (element) domain = cellText(element[1]);
    }
    contexts.set(id, { id, domain });
  }
  return contexts;
}

function headerOf(grid) {
  if (!grid || grid.refused) return null;
  let portfolio = null;
  let type = null;
  let fair = null;
  for (const cell of grid.cells) {
    const label = headerLabel(cell.label);
    if (portfolio === null && PORTFOLIO_HEADER.test(label)) portfolio = { ...cell, label };
    if (type === null && TYPE_HEADER.test(label)) type = { ...cell, label };
    if (fair === null && FAIR_VALUE_HEADER.test(label)) fair = { ...cell, label };
  }
  if (!portfolio || !type || !fair) return null;
  if (new Set([portfolio.slot, type.slot, fair.slot]).size !== 3) return null;
  return {
    portfolioSlot: portfolio.slot,
    portfolioLabel: portfolio.label,
    typeSlot: type.slot,
    fairValueSlot: fair.slot,
  };
}

function textAt(grid, slot) {
  const cell = grid.cells.find((item) => slot >= item.slot && slot < item.slot + item.colspan);
  return cell ? cell.text : "";
}

function isCompanyRow(grid, header) {
  if (!grid || grid.refused || grid.slotCount !== header.slotCount) return false;
  const filled = grid.cells.filter((cell) => cell.text !== "");
  if (filled.length !== 1) return false;
  const company = filled[0];
  if (company.slot !== header.portfolioSlot) return false;
  if (company.text === header.portfolioLabel) return false;
  return true;
}

function linesFor(grid, contexts) {
  const grouped = new Map();
  for (const cell of grid.cells) {
    for (const fact of cell.facts) {
      const context = contexts.get(fact.contextRef);
      if (!context || context.domain == null || context.domain === "") continue;
      if (!grouped.has(fact.contextRef)) {
        grouped.set(fact.contextRef, { contextId: fact.contextRef, domain: context.domain, facts: [] });
      }
      grouped.get(fact.contextRef).facts.push({ ...fact, slot: cell.slot });
    }
  }
  return [...grouped.values()];
}

function describeRow(row, startOrdinal, contexts) {
  const lines = row.ordinal === startOrdinal ? [] : linesFor(row.grid, contexts);
  const hasFact = row.grid.cells.some((cell) => cell.facts.length > 0);
  let kind = "continuation";
  if (row.ordinal === startOrdinal) kind = "company";
  else if (lines.length > 0) kind = "line";
  else if (hasFact) kind = "total";
  return {
    rowOrdinal: row.ordinal,
    kind,
    portfolioSlotText: textAt(row.grid, row.header.portfolioSlot),
    cells: row.grid.cells.filter((cell) => cell.text !== "" || cell.facts.length > 0).map((cell) => ({
      slot: cell.slot,
      text: cell.text,
    })),
    lines,
  };
}

function sectionHeader(rows, index) {
  const header = headerOf(rows[index].grid);
  if (!header) return null;
  return { ...header, slotCount: rows[index].grid.slotCount, rowOrdinal: rows[index].ordinal };
}

export function parseScheduleDisclosureBlocksV1(html) {
  const source = Buffer.isBuffer(html) ? html.toString("utf8") : html;
  if (typeof source !== "string") throw new Error("schedule disclosure parser requires HTML text");
  const contexts = indexContexts(source);
  const rows = tableRows(source).map((fragment, index) => ({
    ordinal: index + 1,
    grid: buildGrid(fragment),
  }));
  const blocks = [];
  const refusals = [];
  let index = 0;
  while (index < rows.length) {
    const header = sectionHeader(rows, index);
    if (!header) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < rows.length) {
      if (sectionHeader(rows, cursor)) break;
      const grid = rows[cursor].grid;
      if (grid.refused || grid.slotCount !== header.slotCount || !isCompanyRow(grid, header)) {
        cursor += 1;
        continue;
      }
      const start = cursor;
      let end = cursor;
      let refusal = null;
      let next = cursor + 1;
      while (next < rows.length) {
        if (sectionHeader(rows, next)) break;
        const following = rows[next].grid;
        if (following.refused) {
          refusal = { startRowOrdinal: rows[start].ordinal, rowOrdinal: rows[next].ordinal, reason: following.reason };
          break;
        }
        if (following.slotCount !== header.slotCount) break;
        // The first detail row often puts the industry in the Portfolio Company slot.
        // A block ends at the next company row or the next schedule header.
        if (isCompanyRow(following, header)) break;
        end = next;
        next += 1;
      }
      if (refusal) {
        refusals.push(refusal);
        cursor = next + 1;
        continue;
      }
      const included = rows.slice(start, end + 1).map((row) => ({ ...row, header }));
      blocks.push({
        headerRowOrdinal: header.rowOrdinal,
        portfolioCompanySlot: header.portfolioSlot,
        typeSlot: header.typeSlot,
        fairValueSlot: header.fairValueSlot,
        startRowOrdinal: rows[start].ordinal,
        endRowOrdinal: rows[end].ordinal,
        companyText: textAt(rows[start].grid, header.portfolioSlot),
        rows: included.map((row) => describeRow(row, rows[start].ordinal, contexts)),
      });
      cursor = next;
    }
    index = cursor;
  }
  return { blocks, refusals };
}

function isSectionBoundaryRow(grid, header) {
  if (!grid || grid.refused || grid.slotCount !== header.slotCount) return false;
  return textAt(grid, header.portfolioSlot) !== "" && textAt(grid, header.typeSlot) === "";
}

function hasFollowingInvestmentDetail(rows, start, header) {
  for (let next = start + 1; next < rows.length; next += 1) {
    if (sectionHeader(rows, next)) return false;
    const grid = rows[next].grid;
    if (grid.refused) return true;
    if (grid.slotCount !== header.slotCount) return false;
    if (isSectionBoundaryRow(grid, header)) return false;
    if (textAt(grid, header.typeSlot) !== "") return true;
  }
  return false;
}

function classifyRowV2(row, startOrdinal, contexts) {
  const lines = row.ordinal === startOrdinal ? [] : linesFor(row.grid, contexts);
  const hasFact = row.grid.cells.some((cell) => cell.facts.length > 0);
  const portfolio = textAt(row.grid, row.header.portfolioSlot);
  const type = textAt(row.grid, row.header.typeSlot);
  let kind = ROW_KIND.OTHER;
  if (row.ordinal === startOrdinal) kind = ROW_KIND.COMPANY;
  else if (lines.length > 0) kind = ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER;
  else if (type !== "") kind = ROW_KIND.INVESTMENT_LINE_WITHOUT_IDENTIFIER;
  else if (hasFact && portfolio === "") kind = ROW_KIND.TOTAL_OR_SUBTOTAL;
  return {
    rowOrdinal: row.ordinal,
    kind,
    portfolioSlotText: portfolio,
    cells: row.grid.cells.filter((cell) => cell.text !== "" || cell.facts.length > 0).map((cell) => ({
      slot: cell.slot,
      text: cell.text,
    })),
    lines,
  };
}

function skipSectionAggregates(rows, cursor, header, excluded) {
  while (cursor < rows.length && !sectionHeader(rows, cursor)) {
    const grid = rows[cursor].grid;
    if (grid.refused || grid.slotCount !== header.slotCount) break;
    if (!isSectionBoundaryRow(grid, header) || isCompanyRow(grid, header)) break;
    excluded.push({
      rowOrdinal: rows[cursor].ordinal,
      classification: ROW_KIND.SECTION_BOUNDARY,
      text: textAt(grid, header.portfolioSlot),
    });
    cursor += 1;
  }
  return cursor;
}

export function parseScheduleDisclosureBlocksV2(html) {
  const source = Buffer.isBuffer(html) ? html.toString("utf8") : html;
  if (typeof source !== "string") throw new Error("schedule disclosure parser requires HTML text");
  const contexts = indexContexts(source);
  const rows = tableRows(source).map((fragment, index) => ({
    ordinal: index + 1,
    grid: buildGrid(fragment),
  }));
  const blocks = [];
  const refusals = [];
  const excludedRows = [];
  let index = 0;
  while (index < rows.length) {
    const header = sectionHeader(rows, index);
    if (!header) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < rows.length) {
      if (sectionHeader(rows, cursor)) break;
      const grid = rows[cursor].grid;
      if (grid.refused || grid.slotCount !== header.slotCount || !isCompanyRow(grid, header)) {
        cursor += 1;
        continue;
      }
      if (!hasFollowingInvestmentDetail(rows, cursor, header)) {
        excludedRows.push({
          rowOrdinal: rows[cursor].ordinal,
          classification: ROW_KIND.SECTION_LABEL,
          text: textAt(grid, header.portfolioSlot),
        });
        cursor += 1;
        continue;
      }
      const start = cursor;
      let end = cursor;
      let refusal = null;
      let next = cursor + 1;
      while (next < rows.length) {
        if (sectionHeader(rows, next)) break;
        const following = rows[next].grid;
        if (following.refused) {
          refusal = { startRowOrdinal: rows[start].ordinal, rowOrdinal: rows[next].ordinal, reason: following.reason };
          break;
        }
        if (following.slotCount !== header.slotCount) break;
        if (isSectionBoundaryRow(following, header)) break;
        end = next;
        next += 1;
      }
      if (refusal) {
        refusals.push(refusal);
        cursor = next + 1;
        continue;
      }
      const included = rows.slice(start, end + 1).map((row) => ({ ...row, header }));
      blocks.push({
        parserVersion: PARSER_VERSION,
        headerRowOrdinal: header.rowOrdinal,
        portfolioCompanySlot: header.portfolioSlot,
        typeSlot: header.typeSlot,
        fairValueSlot: header.fairValueSlot,
        startRowOrdinal: rows[start].ordinal,
        endRowOrdinal: rows[end].ordinal,
        companyText: textAt(rows[start].grid, header.portfolioSlot),
        rows: included.map((row) => classifyRowV2(row, rows[start].ordinal, contexts)),
      });
      cursor = skipSectionAggregates(rows, next, header, excludedRows);
    }
    index = cursor;
  }
  return { blocks, refusals, excludedRows };
}

export function parseScheduleDisclosureBlocks(html) {
  return parseScheduleDisclosureBlocksV2(html);
}

export function assertFilingCompanyCell(block, source) {
  if (!block || source.slot !== block.portfolioCompanySlot) {
    throw new Error("slot mismatch");
  }
  if (source.rawText !== block.companyText) {
    throw new Error("company text mismatch");
  }
}

export function assertLineFact(block, fact) {
  if (!block || fact.rowOrdinal < block.startRowOrdinal || fact.rowOrdinal > block.endRowOrdinal) {
    throw new Error("row outside block");
  }
  const row = block.rows.find((item) => item.rowOrdinal === fact.rowOrdinal);
  const line = row?.lines.find((item) => item.contextId === fact.contextId);
  if (!line) throw new Error("context mismatch");
  return line;
}
