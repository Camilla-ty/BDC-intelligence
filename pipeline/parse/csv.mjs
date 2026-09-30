// RFC 4180 style CSV reader that keeps each record's exact source text. Handles quoted fields,
// doubled quotes, commas and line breaks inside quotes, and CRLF or LF terminators.
// A leading byte-order mark is reported and removed from the first header cell only.

export function parseCsvRecords(text) {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const records = [];
  let cells = [];
  let field = "";
  let quoted = false;
  let recordStart = 0;
  let line = 1;
  let recordLine = 1;

  const finish = (end) => {
    cells.push(field);
    records.push({ lineNumber: recordLine, raw: body.slice(recordStart, end), cells });
    cells = [];
    field = "";
  };

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === "\n") line += 1;
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      cells.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      const end = i;
      if (c === "\r" && body[i + 1] === "\n") i += 1;
      finish(end);
      line += 1;
      recordStart = i + 1;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (recordStart < body.length) finish(body.length);
  return { bom, records };
}
