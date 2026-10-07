import test from "node:test";
import assert from "node:assert/strict";
import {
  FACT_FOOTNOTE_ARCROLE, FOOTNOTE_REF_STATE, HTML_TYPE_SOURCE_RULES, continuityTypeText,
  documentUnavailable, notApplicable, trailingMarkerRun, verifyTypeFootnoteRefs,
} from "../normalize/instrument-type-footnote-ref.mjs";
import { continuityKey, instrumentKey } from "../normalize/instrument-identity.mjs";

// TEST ONLY synthetic Inline XBRL. Row 1 is a header, rows 2+ are detail rows in order.
function td(text) {
  return `<td>${text}</td>`;
}

function fact(id) {
  return `<ix:nonFraction id="${id}" name="us-gaap:InvestmentOwnedAtFairValue" contextRef="c-${id}">1</ix:nonFraction>`;
}

function footnote(id, label) {
  return `<p><span>(${label})</span></p><ix:footnote id="${id}" xml:lang="en-US">TEST ONLY footnote text ${id}</ix:footnote>`;
}

function relationship(from, to, arcrole = FACT_FOOTNOTE_ARCROLE) {
  const role = arcrole == null ? "" : ` arcrole="${arcrole}"`;
  return `<ix:relationship fromRefs="${from}" toRefs="${to}"${role}/>`;
}

function doc({ rows, notes = [], links = [] }) {
  const body = rows.map(([type, factIds]) => `<tr>${td("TEST COMPANY")}${td(type)}${td(factIds.map(fact).join(""))}</tr>`);
  return `<html><body><ix:header><ix:resources>${links.join("")}</ix:resources></ix:header>`
    + `<table><tr>${td("Company")}${td("Type of Investment")}${td("Fair Value")}</tr>${body.join("")}</table>`
    + `${notes.join("")}</body></html>`;
}

function verify(rawText, spec, rowOrdinal = 2) {
  return verifyTypeFootnoteRefs({ html: doc(spec), rowOrdinal, rawText });
}

const TWO_SIX_EIGHT = {
  rows: [["First Lien(2)(6)(8)", ["f-1", "f-2"]]],
  notes: [footnote("fn-a", 2), footnote("fn-b", 6), footnote("fn-c", 8)],
  links: [relationship("f-1", "fn-a fn-b"), relationship("f-2", "fn-c")],
};

test("candidate run is only a trailing run of (digits) groups", () => {
  assert.deepEqual(trailingMarkerRun("First Lien(2)(6)(8)").markers, ["2", "6", "8"]);
  assert.equal(trailingMarkerRun("First Lien(2)(6)(8)").remainder, "First Lien");
  assert.deepEqual(trailingMarkerRun("First Lien (2) (5)").markers, ["2", "5"]);
  assert.equal(trailingMarkerRun("First Lien (2) (5)").remainder, "First Lien");
  assert.equal(trailingMarkerRun("First Lien (SOFR + 0.00%)"), null);
  assert.equal(trailingMarkerRun("Unitranche (13) - TEST"), null);
  assert.equal(trailingMarkerRun("Class A2"), null);
  assert.equal(trailingMarkerRun("Loan4"), null);
  assert.equal(trailingMarkerRun("First Lien(2) "), null);
  assert.equal(trailingMarkerRun("First Lien(a)"), null);
  assert.equal(trailingMarkerRun(null), null);
});

test("First Lien(2)(6)(8) normalizes to First Lien when every marker is a row-linked footnote", () => {
  const ref = verify("First Lien(2)(6)(8)", TWO_SIX_EIGHT);
  assert.equal(ref.state, FOOTNOTE_REF_STATE.VERIFIED);
  assert.equal(ref.reason, "ALL_MARKERS_ROW_LINKED");
  assert.equal(ref.rawText, "First Lien(2)(6)(8)");
  assert.equal(ref.normalizedText, "First Lien");
  assert.deepEqual(ref.removedMarkers, ["2", "6", "8"]);
  assert.deepEqual(ref.footnoteIds, ["fn-a", "fn-b", "fn-c"]);
  assert.equal(continuityTypeText(ref), "First Lien");
});

test("First Lien(2)(5) normalizes to First Lien when verified", () => {
  const ref = verify("First Lien(2)(5)", {
    rows: [["First Lien(2)(5)", ["f-1"]]],
    notes: [footnote("fn-a", 2), footnote("fn-e", 5)],
    links: [relationship("f-1", "fn-a fn-e")],
  });
  assert.equal(ref.state, FOOTNOTE_REF_STATE.VERIFIED);
  assert.equal(ref.normalizedText, "First Lien");
  assert.deepEqual(ref.footnoteIds, ["fn-a", "fn-e"]);
});

test("one unverified marker keeps the whole run unchanged", () => {
  const ref = verify("First Lien(2)(9)", {
    rows: [["First Lien(2)(9)", ["f-1"]]],
    notes: [footnote("fn-a", 2), footnote("fn-i", 9)],
    links: [relationship("f-1", "fn-a")],
  });
  assert.equal(ref.state, FOOTNOTE_REF_STATE.UNVERIFIED);
  assert.equal(ref.reason, "MARKER_NOT_LINKED");
  assert.equal(ref.failedMarker, "9");
  assert.equal(ref.normalizedText, "First Lien(2)(9)");
  assert.deepEqual(ref.removedMarkers, []);
  assert.deepEqual(ref.footnoteIds, []);
  assert.equal(continuityTypeText(ref), "First Lien(2)(9)");
});

test("a footnote linked only from another row does not verify the marker", () => {
  const ref = verify("First Lien(2)", {
    rows: [["First Lien(2)", ["f-1"]], ["Second Lien(2)", ["f-2"]]],
    notes: [footnote("fn-a", 2)],
    links: [relationship("f-2", "fn-a")],
  });
  assert.equal(ref.state, FOOTNOTE_REF_STATE.UNVERIFIED);
  assert.equal(ref.reason, "MARKER_NOT_LINKED");
});

test("a parenthesized pricing term is not stripped", () => {
  assert.equal(verify("First Lien (SOFR + 0.00%)", {
    rows: [["First Lien (SOFR + 0.00%)", ["f-1"]]],
  }).state, FOOTNOTE_REF_STATE.NO_CANDIDATE);
  const ref = verify("First Lien (SOFR + 0.00%)(2)", {
    rows: [["First Lien (SOFR + 0.00%)(2)", ["f-1"]]],
    notes: [footnote("fn-a", 2)],
    links: [relationship("f-1", "fn-a")],
  });
  assert.equal(ref.normalizedText, "First Lien (SOFR + 0.00%)");
});

test("Drawn and Undrawn stay distinct", () => {
  const spec = (type) => ({ rows: [[type, ["f-1"]]], notes: [footnote("fn-a", 2)], links: [relationship("f-1", "fn-a")] });
  const drawn = verify("First Lien - Drawn(2)", spec("First Lien - Drawn(2)"));
  const undrawn = verify("First Lien - Undrawn(2)", spec("First Lien - Undrawn(2)"));
  assert.equal(drawn.normalizedText, "First Lien - Drawn");
  assert.equal(undrawn.normalizedText, "First Lien - Undrawn");
  assert.notEqual(continuityTypeText(drawn), continuityTypeText(undrawn));
});

test("middle markers and attached digits are unchanged", () => {
  for (const type of ["Unitranche (13) - TEST", "Class A2", "Loan4", "First Lien (2) Delayed Draw"]) {
    const ref = verify(type, { rows: [[type, ["f-1"]]], notes: [footnote("fn-a", 13)], links: [relationship("f-1", "fn-a")] });
    assert.equal(ref.state, FOOTNOTE_REF_STATE.NO_CANDIDATE, type);
    assert.equal(ref.normalizedText, type);
  }
  const attached = verify("Tranche B2(2)", {
    rows: [["Tranche B2(2)", ["f-1"]]], notes: [footnote("fn-a", 2)], links: [relationship("f-1", "fn-a")],
  });
  assert.equal(attached.normalizedText, "Tranche B2");
});

test("case, spacing, and lien differences stay distinct", () => {
  const spec = (type) => ({ rows: [[type, ["f-1"]]], notes: [footnote("fn-a", 2)], links: [relationship("f-1", "fn-a")] });
  const text = (type) => continuityTypeText(verify(type, spec(type)));
  assert.equal(text("First Lien(2)"), "First Lien");
  assert.equal(text("First lien(2)"), "First lien");
  assert.equal(text("First  Lien(2)"), "First  Lien");
  assert.equal(text("Second Lien(2)"), "Second Lien");
  assert.equal(new Set([text("First Lien(2)"), text("First lien(2)"), text("First  Lien(2)"), text("Second Lien(2)")]).size, 4);
});

test("SOI dataset values are never in scope", () => {
  assert.equal(HTML_TYPE_SOURCE_RULES.includes("obs.projection.soi"), false);
  const ref = notApplicable("First Lien(2)");
  assert.equal(ref.state, FOOTNOTE_REF_STATE.NOT_APPLICABLE);
  assert.equal(ref.normalizedText, "First Lien(2)");
  assert.equal(continuityTypeText(ref), "First Lien(2)");
});

test("omitted arcrole uses the Inline XBRL fact-footnote default; another arcrole does not link", () => {
  const omitted = verify("First Lien(2)", {
    rows: [["First Lien(2)", ["f-1"]]], notes: [footnote("fn-a", 2)], links: [relationship("f-1", "fn-a", null)],
  });
  assert.equal(omitted.state, FOOTNOTE_REF_STATE.VERIFIED);
  const other = verify("First Lien(2)", {
    rows: [["First Lien(2)", ["f-1"]]],
    notes: [footnote("fn-a", 2)],
    links: [relationship("f-1", "fn-a", "http://www.xbrl.org/2009/arcrole/fact-explanatoryFact")],
  });
  assert.equal(other.state, FOOTNOTE_REF_STATE.UNVERIFIED);
  assert.equal(other.reason, "MARKER_NOT_LINKED");
});

test("duplicate labels linked from the same row fail closed", () => {
  const ref = verify("First Lien(2)", {
    rows: [["First Lien(2)", ["f-1", "f-2"]]],
    notes: [footnote("fn-a", 2), footnote("fn-z", 2)],
    links: [relationship("f-1", "fn-a"), relationship("f-2", "fn-z")],
  });
  assert.equal(ref.state, FOOTNOTE_REF_STATE.UNVERIFIED);
  assert.equal(ref.reason, "AMBIGUOUS_MARKER_LABEL");
  assert.equal(ref.normalizedText, "First Lien(2)");
});

test("a label repeated elsewhere in the document but linked once from the row verifies", () => {
  const ref = verify("First Lien(2)", {
    rows: [["First Lien(2)", ["f-1"]], ["First Lien(2)", ["f-2"]]],
    notes: [footnote("fn-a", 2), footnote("fn-z", 2)],
    links: [relationship("f-1", "fn-a"), relationship("f-2", "fn-z")],
  });
  assert.equal(ref.state, FOOTNOTE_REF_STATE.VERIFIED);
  assert.deepEqual(ref.footnoteIds, ["fn-a"]);
});

test("row, cell, fact, and document problems fail closed", () => {
  assert.equal(verify("First Lien(2)(6)(8)", TWO_SIX_EIGHT, 9).reason, "ROW_NOT_FOUND");
  assert.equal(verify("First Lien(2)(6)(8)", TWO_SIX_EIGHT, 1).reason, "TYPE_CELL_NOT_IN_ROW");
  assert.equal(verify("First Lien(2)", { rows: [["First Lien(2)", []]], notes: [footnote("fn-a", 2)] }).reason, "NO_ROW_FACTS");
  assert.equal(verify("(2)", { rows: [["(2)", ["f-1"]]] }).reason, "NOTHING_LEFT_AFTER_MARKERS");
  const missing = verifyTypeFootnoteRefs({ html: null, rowOrdinal: 2, rawText: "First Lien(2)" });
  assert.equal(missing.reason, "DOCUMENT_UNAVAILABLE");
  assert.equal(missing.normalizedText, "First Lien(2)");
  assert.equal(documentUnavailable("First Lien(2)").state, FOOTNOTE_REF_STATE.UNVERIFIED);
  assert.equal(documentUnavailable("First Lien").state, FOOTNOTE_REF_STATE.NO_CANDIDATE);
});

test("continuity keys stay per registrant and instrument keys keep the raw type", () => {
  assert.notEqual(continuityKey(1, "TEST ID", "First Lien"), continuityKey(2, "TEST ID", "First Lien"));
  assert.notEqual(continuityKey(1, "TEST ID", "First Lien"), continuityKey(1, "TEST ID 2", "First Lien"));
  assert.notEqual(instrumentKey("TEST ID", "First Lien(2)(6)(8)"), instrumentKey("TEST ID", "First Lien(2)(5)"));
  assert.throws(() => continuityKey(null, "TEST ID", "First Lien"));
});
