// Quoted TSV field split for NUM recovery (ADR 0019).
// Tabs outside quotes remain delimiters. Tabs inside a quoted field stay in that field.
// Doubled quotes ("") are one literal quote. Unclosed or mid-field quotes are rejected.
// The loader uses recoverQuotedNumCells; invalid syntax returns null and stays quarantined.

export function splitQuotedTsvFields(line) {
  if (typeof line !== "string") throw new Error("quoted TSV split requires a string");

  const cells = [];
  const quoteMeta = [];
  let field = "";
  let quoted = false;
  let fieldQuoted = false;
  let tabsInside = 0;
  let doubledQuotes = 0;

  const finishField = () => {
    cells.push(field);
    quoteMeta.push({ quoted: fieldQuoted, tabsInside, doubledQuotes });
    field = "";
    fieldQuoted = false;
    tabsInside = 0;
    doubledQuotes = 0;
  };

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        doubledQuotes += 1;
        i += 1;
      } else if (c === '"') {
        quoted = false;
        const next = line[i + 1];
        if (next !== undefined && next !== "\t") {
          throw new Error("quoted TSV quote must be followed by a tab or the end of the line");
        }
      } else {
        if (c === "\t") tabsInside += 1;
        field += c;
      }
    } else if (c === '"') {
      if (field !== "") throw new Error("quoted TSV quote must start a field");
      quoted = true;
      fieldQuoted = true;
    } else if (c === "\t") {
      finishField();
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error("quoted TSV field is not closed");
  finishField();
  return { cells, quoteMeta };
}

export function recoverQuotedNumCells(line, width) {
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new Error("quoted NUM recovery requires a positive header width");
  }
  try {
    const parsed = splitQuotedTsvFields(line);
    if (parsed.cells.length !== width) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function footlenMatchesUnquotedFootnote(footnote, footlenRaw) {
  if (typeof footnote !== "string" || typeof footlenRaw !== "string") return false;
  if (!/^[0-9]+$/.test(footlenRaw)) return false;
  return Buffer.byteLength(footnote, "utf8") === Number(footlenRaw);
}
