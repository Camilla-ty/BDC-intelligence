// norm.instrument_type_footnote_ref v1: removes a trailing run of "(n)" footnote markers from an
// INSTRUMENT_TYPE value read from an HTML disclosure cell, only when every marker is verified
// against Inline XBRL footnotes linked from facts on the same table row of the same stored
// document (docs/SOURCE_SCHEMAS.md 8.1; docs/METHODOLOGY.md 7.7). Anything else fails closed and
// keeps the original text. SOI dataset values are never in scope. No case or spacing rewrite.

import { tableRows } from "./ix-context-row.mjs";
import { cellText } from "../parse/schedule-disclosure-block.mjs";

export const FOOTNOTE_REF_CODE = "norm.instrument_type_footnote_ref";
export const FOOTNOTE_REF_VERSION = "1";
export const FACT_FOOTNOTE_ARCROLE = "http://www.xbrl.org/2003/arcrole/fact-footnote";

// INSTRUMENT_TYPE values extracted from an HTML disclosure cell. The SOI projection is not listed.
export const HTML_TYPE_SOURCE_RULES = Object.freeze([
  "obs.research_field.exact_disclosure_cell",
  "obs.research_field.bound_context_cell",
]);

export const FOOTNOTE_REF_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  NO_CANDIDATE: "NO_CANDIDATE",
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
});

export const FOOTNOTE_REF_REASON = Object.freeze({
  NOT_HTML_DISCLOSURE_CELL: "NOT_HTML_DISCLOSURE_CELL",
  NO_TRAILING_MARKER_RUN: "NO_TRAILING_MARKER_RUN",
  ALL_MARKERS_ROW_LINKED: "ALL_MARKERS_ROW_LINKED",
  NOTHING_LEFT_AFTER_MARKERS: "NOTHING_LEFT_AFTER_MARKERS",
  DOCUMENT_UNAVAILABLE: "DOCUMENT_UNAVAILABLE",
  ROW_NOT_FOUND: "ROW_NOT_FOUND",
  TYPE_CELL_NOT_IN_ROW: "TYPE_CELL_NOT_IN_ROW",
  NO_ROW_FACTS: "NO_ROW_FACTS",
  MARKER_NOT_LINKED: "MARKER_NOT_LINKED",
  AMBIGUOUS_MARKER_LABEL: "AMBIGUOUS_MARKER_LABEL",
});

const LABEL_LOOKBEHIND = 2000;

// Only a run of "(digits)" groups at the very end of the text is a candidate. Whitespace is allowed
// between groups and before the first group; that separator belongs to the run, nothing else does.
export function trailingMarkerRun(text) {
  if (typeof text !== "string") return null;
  const match = /(?:\s*\(\d+\))+$/.exec(text);
  if (!match) return null;
  const markers = [...match[0].matchAll(/\((\d+)\)/g)].map((m) => m[1]);
  return { start: match.index, run: match[0], markers, remainder: text.slice(0, match.index) };
}

function attr(raw, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(raw);
  if (!match) return null;
  return match[2] ?? match[3];
}

function refs(value) {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

// The visible "(n)" next to an ix:footnote is filing presentation, not an XBRL requirement:
// the label is the text that ends immediately before the ix:footnote element.
export function ixFootnotes(html) {
  const notes = [];
  let previousEnd = 0;
  for (const match of html.matchAll(/<ix:footnote\b([^>]*)>([\s\S]*?)<\/ix:footnote>/g)) {
    const from = Math.max(previousEnd, match.index - LABEL_LOOKBEHIND);
    const cut = html.indexOf("<", from);
    const before = cut >= 0 && cut < match.index ? cellText(html.slice(cut, match.index)) : "";
    const label = /\((\d+)\)\s*$/.exec(before.replace(/\u00a0/g, " "))?.[1] ?? null;
    notes.push({ id: attr(match[1], "id"), label });
    previousEnd = match.index + match[0].length;
  }
  return notes;
}

// Fact-to-footnote links. A relationship with no arcrole uses the Inline XBRL 1.1 default
// (fact-footnote); any other explicit arcrole is not a footnote link for this rule.
export function factFootnoteLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<ix:relationship\b([^>]*?)\/?>/g)) {
    const arcrole = attr(match[1], "arcrole");
    if (arcrole != null && arcrole !== FACT_FOOTNOTE_ARCROLE) continue;
    for (const from of refs(attr(match[1], "fromRefs"))) {
      for (const to of refs(attr(match[1], "toRefs"))) links.push({ from, to });
    }
  }
  return links;
}

function rowFactIds(rowHtml) {
  const ids = new Set();
  for (const match of rowHtml.matchAll(/<ix:(?:nonFraction|nonNumeric|fraction)\b([^>]*)>/g)) {
    const id = attr(match[1], "id");
    if (id) ids.add(id);
  }
  return ids;
}

function rowCellTexts(rowHtml) {
  return [...rowHtml.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => cellText(m[2]));
}

function result(rawText, state, reason, extra = {}) {
  return {
    state,
    reason,
    rawText,
    normalizedText: rawText,
    removedMarkers: [],
    footnoteIds: [],
    ...extra,
  };
}

export function notApplicable(rawText) {
  return result(rawText, FOOTNOTE_REF_STATE.NOT_APPLICABLE, FOOTNOTE_REF_REASON.NOT_HTML_DISCLOSURE_CELL);
}

export function documentUnavailable(rawText) {
  const candidate = trailingMarkerRun(rawText);
  if (!candidate) return result(rawText, FOOTNOTE_REF_STATE.NO_CANDIDATE, FOOTNOTE_REF_REASON.NO_TRAILING_MARKER_RUN);
  return result(rawText, FOOTNOTE_REF_STATE.UNVERIFIED, FOOTNOTE_REF_REASON.DOCUMENT_UNAVAILABLE, {
    candidateMarkers: candidate.markers,
  });
}

// html: the stored filing document the type cell was read from.
// rowOrdinal: 1-based tableRows() ordinal recorded on the type cell's evidence.
export function verifyTypeFootnoteRefs({ html, rowOrdinal, rawText }) {
  const candidate = trailingMarkerRun(rawText);
  if (!candidate) return result(rawText, FOOTNOTE_REF_STATE.NO_CANDIDATE, FOOTNOTE_REF_REASON.NO_TRAILING_MARKER_RUN);
  const unverified = (reason, extra = {}) => result(rawText, FOOTNOTE_REF_STATE.UNVERIFIED, reason, {
    candidateMarkers: candidate.markers,
    ...extra,
  });
  if (!/\S/.test(candidate.remainder)) return unverified(FOOTNOTE_REF_REASON.NOTHING_LEFT_AFTER_MARKERS);
  if (typeof html !== "string") return unverified(FOOTNOTE_REF_REASON.DOCUMENT_UNAVAILABLE);

  const row = Number.isSafeInteger(rowOrdinal) && rowOrdinal >= 1 ? tableRows(html)[rowOrdinal - 1] : undefined;
  if (row === undefined) return unverified(FOOTNOTE_REF_REASON.ROW_NOT_FOUND);
  if (!rowCellTexts(row).includes(rawText)) return unverified(FOOTNOTE_REF_REASON.TYPE_CELL_NOT_IN_ROW);
  const facts = rowFactIds(row);
  if (facts.size === 0) return unverified(FOOTNOTE_REF_REASON.NO_ROW_FACTS);

  const linkedIds = new Set(factFootnoteLinks(html).filter((l) => facts.has(l.from)).map((l) => l.to));
  const linked = ixFootnotes(html).filter((note) => note.id && linkedIds.has(note.id));
  const footnoteIds = [];
  for (const marker of candidate.markers) {
    const matches = linked.filter((note) => note.label === marker);
    if (matches.length === 0) return unverified(FOOTNOTE_REF_REASON.MARKER_NOT_LINKED, { failedMarker: marker });
    if (matches.length > 1) return unverified(FOOTNOTE_REF_REASON.AMBIGUOUS_MARKER_LABEL, { failedMarker: marker });
    footnoteIds.push(matches[0].id);
  }
  return {
    state: FOOTNOTE_REF_STATE.VERIFIED,
    reason: FOOTNOTE_REF_REASON.ALL_MARKERS_ROW_LINKED,
    rawText,
    normalizedText: candidate.remainder,
    removedMarkers: candidate.markers,
    footnoteIds,
  };
}

// The text continuity compares: the verified normalized text, otherwise the raw text unchanged.
export function continuityTypeText(ref) {
  return ref.state === FOOTNOTE_REF_STATE.VERIFIED ? ref.normalizedText : ref.rawText;
}
