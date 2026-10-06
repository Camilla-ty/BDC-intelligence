// Deterministic iXBRL row locator. A row is the <tr> whose ix facts use one contextRef.
// Untagged text is what remains after those ix elements are removed. No fuzzy match and no
// identifier-text comparison.

import { decodeHtmlEntities, stripTags } from "./filing-text.mjs";

function ixBlock() {
  return /<ix:(nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:\1>/g;
}

function htmlText(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value !== "string") throw new Error("ix context row parser requires HTML text");
  return value;
}

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return null;
  return match[2] ?? match[3];
}

export function tableRows(html) {
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
    rows.push(html.slice(start, end + "</tr>".length));
    from = end + "</tr>".length;
  }
  return rows;
}

function ixFacts(row) {
  const facts = [];
  for (const match of row.matchAll(ixBlock())) {
    const id = attr(match[2], "id");
    const contextRef = attr(match[2], "contextRef");
    if (!id || !contextRef) continue;
    facts.push({
      id,
      name: attr(match[2], "name"),
      contextRef,
      text: stripTags(decodeHtmlEntities(match[3])).replace(/\s+/g, " ").trim(),
      scale: attr(match[2], "scale"),
      sign: attr(match[2], "sign"),
      format: attr(match[2], "format"),
    });
  }
  return facts;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Period end of each xbrli:context: the instant, or the endDate of a duration.
// A context id declared twice, or a period that is not yyyy-mm-dd, has no period end.
function contextPeriodEnds(source) {
  const ends = new Map();
  const seen = new Set();
  for (const match of source.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g)) {
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

function dateTexts(text) {
  return [...text.matchAll(/(?<![0-9])(\d{1,2}\/\d{1,2}\/\d{4})(?![0-9])/g)].map((match) => match[1]);
}

function rowText(row) {
  const withoutFacts = row.replace(ixBlock(), "");
  return stripTags(decodeHtmlEntities(withoutFacts)).replace(/\s+/g, " ");
}

function untaggedDates(row) {
  return dateTexts(rowText(row));
}

function untaggedMonthYears(row) {
  return [...rowText(row).matchAll(/(?<![0-9/])(\d{1,2}\/\d{4})(?![0-9])/g)].map((match) => match[1]);
}

function elementRanges(source, tag) {
  const ranges = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(open, from);
    if (start < 0) break;
    const next = source[start + open.length];
    if (next !== ">" && next !== " " && next !== "\n" && next !== "\t" && next !== "/") {
      from = start + open.length;
      continue;
    }
    const end = source.indexOf(close, start);
    if (end < 0) break;
    ranges.push([start, end + close.length]);
    from = end + close.length;
  }
  return ranges;
}

function rowEntries(source) {
  const rows = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf("<tr", from);
    if (start < 0) break;
    const next = source[start + 3];
    if (next !== ">" && next !== " " && next !== "\n" && next !== "\t" && next !== "/") {
      from = start + 3;
      continue;
    }
    const end = source.indexOf("</tr>", start);
    if (end < 0) break;
    rows.push({ start, html: source.slice(start, end + "</tr>".length) });
    from = end + "</tr>".length;
  }
  return rows;
}

function plainFragment(fragment) {
  return stripTags(decodeHtmlEntities(fragment.replace(ixBlock(), ""))).replace(/\s+/g, " ").trim();
}

function parseTdCells(rowHtml) {
  const cells = [];
  let from = 0;
  while (from < rowHtml.length) {
    const start = rowHtml.indexOf("<td", from);
    if (start < 0) break;
    const next = rowHtml[start + 3];
    if (next !== ">" && next !== " " && next !== "\n" && next !== "\t" && next !== "/") {
      from = start + 3;
      continue;
    }
    const gt = rowHtml.indexOf(">", start);
    if (gt < 0) break;
    const open = rowHtml.slice(start, gt + 1);
    const colspan = Number((open.match(/\bcolspan\s*=\s*"(\d+)"/i) || [])[1] || "1");
    const rowspan = Number((open.match(/\browspan\s*=\s*"(\d+)"/i) || [])[1] || "1");
    let inner = "";
    let end = gt + 1;
    if (!open.endsWith("/>")) {
      const close = rowHtml.indexOf("</td>", gt);
      if (close < 0) break;
      inner = rowHtml.slice(gt + 1, close);
      end = close + "</td>".length;
    }
    cells.push({
      colspan: Number.isInteger(colspan) && colspan > 0 ? colspan : 1,
      rowspan: Number.isInteger(rowspan) && rowspan > 0 ? rowspan : 1,
      text: plainFragment(inner),
      inner,
    });
    from = end;
  }
  return cells;
}

function expandTableRows(rowHtmls) {
  const occupied = [];
  return rowHtmls.map((rowHtml, rowIndex) => {
    const placed = [];
    let column = 0;
    const taken = occupied[rowIndex] ?? new Set();
    for (const cell of parseTdCells(rowHtml)) {
      while (taken.has(column)) column += 1;
      const startColumn = column;
      placed.push({ ...cell, startColumn });
      for (let later = 1; later < cell.rowspan; later += 1) {
        if (!occupied[rowIndex + later]) occupied[rowIndex + later] = new Set();
        for (let span = 0; span < cell.colspan; span += 1) {
          occupied[rowIndex + later].add(startColumn + span);
        }
      }
      column += cell.colspan;
    }
    return placed;
  });
}

function soleStartColumn(cells, predicate) {
  const starts = new Set(cells.filter(predicate).map((cell) => cell.startColumn));
  if (starts.size !== 1) return null;
  return [...starts][0];
}

// Whole-cell equality. "Maturity Date" is not a maturity header. A second distinct
// maturity header in the same table fails closed through soleStartColumn.
function isMaturityHeader(text) {
  return text === "Maturity" || text === "Maturity/Expiration Date";
}

// "Purchase Date" is an acquisition header only. It has no numbered-suffix form.
// "Acquisition Date" keeps its existing numbered suffix.
function isAcquisitionHeader(text) {
  return text === "Purchase Date" || /^Acquisition Date(?: \d+)?$/.test(text);
}

function datePlacementsFor(cells) {
  const placements = [];
  for (const cell of cells) {
    const text = plainFragment(cell.inner);
    const raws = [...dateTexts(text), ...[...text.matchAll(/(?<![0-9/])(\d{1,2}\/\d{4})(?![0-9])/g)].map((match) => match[1])];
    for (const raw of raws) {
      placements.push({
        raw,
        startColumn: cell.startColumn,
        colspan: cell.colspan,
        rowspan: cell.rowspan,
      });
    }
  }
  return placements;
}

function listedRow(rowHtml, columns, periodEnds) {
  const facts = ixFacts(rowHtml);
  if (facts.length === 0) return null;
  const contextIds = [...new Set(facts.map((fact) => fact.contextRef))];
  return {
    contextIds,
    contextPeriodEnds: contextIds.map((id) => periodEnds.get(id) ?? null),
    facts,
    untaggedDates: untaggedDates(rowHtml),
    untaggedMonthYears: untaggedMonthYears(rowHtml),
    tableIndex: columns.tableIndex,
    maturityColumn: columns.maturityColumn,
    acquisitionColumn: columns.acquisitionColumn,
    datePlacements: columns.datePlacements,
  };
}

export function listIxContextRows(html) {
  const source = htmlText(html);
  const periodEnds = contextPeriodEnds(source);
  const tables = elementRanges(source, "table");
  const listed = [];
  tables.forEach(([start, end], tableIndex) => {
    const entries = rowEntries(source.slice(start, end));
    const expanded = expandTableRows(entries.map((entry) => entry.html));
    const maturityColumn = soleStartColumn(expanded.flat(), (cell) => isMaturityHeader(cell.text));
    const acquisitionColumn = soleStartColumn(expanded.flat(), (cell) => isAcquisitionHeader(cell.text));
    entries.forEach((entry, index) => {
      const row = listedRow(entry.html, {
        tableIndex,
        maturityColumn,
        acquisitionColumn,
        datePlacements: datePlacementsFor(expanded[index]),
      }, periodEnds);
      if (row) listed.push(row);
    });
  });
  for (const entry of rowEntries(source)) {
    if (tables.some(([start, end]) => entry.start >= start && entry.start < end)) continue;
    const row = listedRow(entry.html, {
      tableIndex: null,
      maturityColumn: null,
      acquisitionColumn: null,
      datePlacements: [],
    }, periodEnds);
    if (row) listed.push(row);
  }
  return listed;
}

export function parseIxContextRow(html, contextId) {
  if (typeof contextId !== "string" || contextId === "") throw new Error("context id is required");
  const source = htmlText(html);
  const matches = tableRows(source)
    .map((row) => ({ facts: ixFacts(row), untaggedDates: untaggedDates(row) }))
    .filter((row) => row.facts.some((fact) => fact.contextRef === contextId));
  if (matches.length !== 1) {
    return {
      contextId,
      rowCount: matches.length,
      facts: [],
      untaggedDates: [],
      taggedDates: [],
    };
  }
  const row = matches[0];
  const facts = row.facts.filter((fact) => fact.contextRef === contextId);
  return {
    contextId,
    rowCount: 1,
    facts,
    untaggedDates: row.untaggedDates,
    taggedDates: facts.flatMap((fact) => dateTexts(fact.text)),
  };
}

export function factBelongsToContext(html, factId, contextId) {
  const parsed = parseIxContextRow(html, contextId);
  if (parsed.rowCount !== 1) return false;
  const hits = parsed.facts.filter((fact) => fact.id === factId && fact.contextRef === contextId);
  return hits.length === 1;
}
