// Date heading normalization, norm.date_heading version 1.
// The heading evidence keeps the filing's words. This rule maps those words to a
// canonical field. It does not write a database row and it does not invent a day.

export const DATE_HEADING_CODE = "norm.date_heading";
export const DATE_HEADING_VERSION = "1";

const SINGLE_HEADING = new Map([
  ["Purchase Date", "ACQUISITION_DATE"],
  ["Acquisition Date", "ACQUISITION_DATE"],
  ["Maturity/Expiration Date", "MATURITY_DATE"],
]);

const MONTH_TEXT = /^(\d{1,2})\/(\d{4})$/;
const DAY_TEXT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function reject(reason) {
  return { accepted: false, reason, fieldCode: null, rawHeadings: [], matchedHeadings: [] };
}

function headingComplete(heading) {
  return heading
    && heading.artifactId != null
    && Number.isInteger(heading.rowOrdinal)
    && Number.isInteger(heading.slotOrdinal)
    && typeof heading.rawText === "string"
    && heading.rawText.trim() !== ""
    && typeof heading.matchedText === "string"
    && heading.matchedText.trim() !== "";
}

// headings are the heading cells for one value column, top to bottom or in any
// order. The rule sorts them by row. It does not read a neighboring column.
export function normalizeDateHeading(headings) {
  if (!Array.isArray(headings) || headings.length === 0 || headings.some((heading) => !headingComplete(heading))) {
    return reject("missing heading");
  }
  const artifactId = headings[0].artifactId;
  const slotOrdinal = headings[0].slotOrdinal;
  if (headings.some((heading) => heading.artifactId !== artifactId)) return reject("heading from another artifact");
  if (headings.some((heading) => heading.slotOrdinal !== slotOrdinal)) return reject("ambiguous heading");
  const ordered = [...headings].sort((left, right) => left.rowOrdinal - right.rowOrdinal);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].rowOrdinal === ordered[index - 1].rowOrdinal) return reject("ambiguous heading");
    if (ordered[index].rowOrdinal !== ordered[index - 1].rowOrdinal + 1) return reject("ambiguous heading");
  }
  const matchedHeadings = ordered.map((heading) => heading.matchedText);
  const rawHeadings = ordered.map((heading) => heading.rawText);
  let fieldCode = null;
  if (matchedHeadings.length === 1 && matchedHeadings[0] === "Date") return reject("generic Date");
  if (matchedHeadings.length === 1) fieldCode = SINGLE_HEADING.get(matchedHeadings[0]) ?? null;
  if (matchedHeadings.length === 2 && matchedHeadings[0] === "Maturity" && matchedHeadings[1] === "Date") {
    fieldCode = "MATURITY_DATE";
  }
  if (fieldCode == null) return reject("ambiguous heading");
  return { accepted: true, reason: null, fieldCode, rawHeadings, matchedHeadings };
}

// A value cell may use a heading only when every heading cell is on an earlier
// row of the same artifact and the same slot. A sibling detail row is not a heading.
export function acceptDateCell(value, headings) {
  if (!value || value.artifactId == null || !Number.isInteger(value.rowOrdinal) || !Number.isInteger(value.slotOrdinal)) {
    return reject("missing heading");
  }
  const decision = normalizeDateHeading(headings);
  if (!decision.accepted) return decision;
  if (headings.some((heading) => heading.artifactId !== value.artifactId || heading.slotOrdinal !== value.slotOrdinal)) {
    return reject(headings.some((heading) => heading.artifactId !== value.artifactId)
      ? "heading from another artifact"
      : "ambiguous heading");
  }
  if (headings.some((heading) => heading.rowOrdinal >= value.rowOrdinal)) return reject("sibling-row inference");
  return decision;
}

function calendarDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Month text stays a year and a month. A day is returned only when the source
// text contains a day. No month is expanded to the first or last day of the month.
export function normalizeDisclosedDate(raw) {
  if (typeof raw !== "string") return { accepted: false, reason: "not a disclosed date", precision: null, normalizedDate: null };
  const month = MONTH_TEXT.exec(raw);
  if (month) {
    const monthNumber = Number(month[1]);
    const year = Number(month[2]);
    if (monthNumber < 1 || monthNumber > 12) {
      return { accepted: false, reason: "not a disclosed date", precision: null, normalizedDate: null };
    }
    return {
      accepted: true,
      reason: null,
      precision: "MONTH",
      year,
      month: monthNumber,
      day: null,
      normalizedDate: null,
      raw,
    };
  }
  const day = DAY_TEXT.exec(raw);
  if (day) {
    const monthNumber = Number(day[1]);
    const dayNumber = Number(day[2]);
    const year = Number(day[3]);
    if (!calendarDay(year, monthNumber, dayNumber)) {
      return { accepted: false, reason: "not a disclosed date", precision: null, normalizedDate: null };
    }
    const normalizedDate = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    return {
      accepted: true,
      reason: null,
      precision: "DAY",
      year,
      month: monthNumber,
      day: dayNumber,
      normalizedDate,
      raw,
    };
  }
  return { accepted: false, reason: "not a disclosed date", precision: null, normalizedDate: null };
}

export function bindObservationDate(observationId, raw) {
  const normalized = normalizeDisclosedDate(raw);
  if (!normalized.accepted) return { ...normalized, observationId };
  return { ...normalized, observationId };
}
