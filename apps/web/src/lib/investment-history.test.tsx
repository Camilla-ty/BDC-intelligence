import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/review/entities/test-candidate",
  useRouter: () => ({ refresh: () => undefined }),
}));

import { EntityReview } from "@/components/EntityReview";
import {
  assembleReview,
  type EntityReviewCandidate,
  type ReviewField,
  type ReviewLine,
  type ReviewPayload,
} from "@/lib/entity-review";
import {
  FILING_LINK_MISSING,
  HISTORY_EXPLANATION,
  historyCoverageNotes,
  investmentHistory,
} from "@/lib/investment-history";
import { CURRENCY_NOTE, EDGAR_ARCHIVES_PREFIX } from "@/lib/portfolios";

const NAMES = [
  "Geo Parent Corporation",
  "Geo Parent Corporation, First Lien",
  "Geo Parent Corporation, First Lien 1",
  "Geo Parent Corporation, First Lien 2",
] as const;

const CIKS = ["9999999901", "9999999902", "9999999903", "9999999904"] as const;
const REGISTRANT_NAMES = ["TEST BDC D", "TEST BDC A", "TEST BDC C", "TEST BDC B"] as const;
const DATES = [
  "2099-03-31",
  "2099-06-30",
  "2099-01-31",
  "2099-09-30",
  "2099-04-30",
  "2099-02-28",
  "2099-08-31",
  "2099-05-31",
] as const;

const FILING_URL = `${EDGAR_ARCHIVES_PREFIX}9999999901/000000000099000001/TEST-ONLY.htm`;

function candidate(): EntityReviewCandidate {
  return {
    id: "test-candidate",
    type: "BORROWER",
    status: "OPEN",
    source: "MANUAL_SEED",
    ruleVersion: null,
    label: "TEST SOURCE",
    descriptors: NAMES,
    scopes: [{ registrantCik: "9999999901", reportedDate: "2099-03-31" }],
  };
}

function emptyPayload(): ReviewPayload {
  return { lines: [], fields: [], names: [], instruments: [], maturity: [], entityResolutionCount: 0, groupMembershipCount: 0 };
}

function line(index: number): ReviewLine {
  return {
    position_observation_id: String(9000000100 + index),
    registrant_cik: CIKS[Math.floor(index / 8)] ?? CIKS[0],
    reported_date: DATES[index % 8] ?? DATES[0],
    disclosed_line_text: NAMES[index % 4] ?? NAMES[0],
    accession_number: `0000000000-99-${String(index).padStart(6, "0")}`,
    evidence_level: "L1_STRUCTURED_DATASET",
    form_state: "UNKNOWN",
    form_raw: null,
    filed_date_state: index === 31 ? "UNKNOWN" : "REPORTED",
    filed_date_raw: index === 31 ? null : "2099-05-15",
    inline_url_state: "UNKNOWN",
    inline_url: null,
    document_name: "TEST-ONLY.htm",
    document_url: index === 31 ? null : FILING_URL,
  };
}

function reported(index: number, code: string, raw: string): ReviewField {
  return {
    position_observation_id: String(9000000100 + index),
    field_code: code,
    raw_value: raw,
    value_state: "REPORTED",
    scale_state: "KNOWN",
    source_column_label: null,
  };
}

function slicePayload(): ReviewPayload {
  const lines = Array.from({ length: 32 }, (_, index) => line(index)).reverse();
  const fields = lines.flatMap((_, index) => {
    const position = 31 - index;
    const stored = [reported(position, "PRINCIPAL_AMOUNT", `TEST-P-${position}`)];
    if (position === 0) stored.push(reported(position, "PERCENT_OF_NET_ASSETS", "TEST-NAV"));
    if (position === 4) stored.push(reported(position, "INTEREST_RATE", "TEST-RATE"));
    return stored;
  });
  return {
    ...emptyPayload(),
    lines,
    fields,
    names: CIKS.map((registrantCik, index) => ({ registrant_cik: registrantCik, name_raw: REGISTRANT_NAMES[index] ?? "TEST BDC" })),
  };
}

function historyFrom(payload: ReviewPayload = slicePayload()) {
  const model = assembleReview(candidate(), payload);
  return {
    model,
    history: investmentHistory(model.groups.flatMap((group) => group.observations)),
  };
}

describe("investment history", () => {
  it("keeps 32 stored observations, four disclosed names, four registrants, and eight periods separate", () => {
    const { history } = historyFrom();
    expect(history.observationCount).toBe(32);
    expect(history.rows).toHaveLength(32);
    expect(new Set(history.rows.map((row) => row.id)).size).toBe(32);
    expect(history.disclosedNameVariants).toBe(4);
    expect(history.registrantContexts).toBe(4);
    expect(history.reportingPeriods).toBe(8);
    expect(history.rows.map((row) => row.disclosedName).sort()).toEqual(
      [...NAMES, ...NAMES, ...NAMES, ...NAMES, ...NAMES, ...NAMES, ...NAMES, ...NAMES].sort(),
    );
    const firstLien = history.rows.filter((row) => row.disclosedName === "Geo Parent Corporation, First Lien");
    const firstLien1 = history.rows.filter((row) => row.disclosedName === "Geo Parent Corporation, First Lien 1");
    const firstLien2 = history.rows.filter((row) => row.disclosedName === "Geo Parent Corporation, First Lien 2");
    const bare = history.rows.filter((row) => row.disclosedName === "Geo Parent Corporation");
    expect(firstLien).toHaveLength(8);
    expect(firstLien1).toHaveLength(8);
    expect(firstLien2).toHaveLength(8);
    expect(bare).toHaveLength(8);
    expect(new Set([...firstLien, ...firstLien1, ...firstLien2, ...bare].map((row) => row.id)).size).toBe(32);
  });

  it("does not duplicate an observation or invent a row for a member the read did not return", () => {
    const { model } = historyFrom();
    const observations = model.groups.flatMap((group) => group.observations);
    const first = observations[0];
    expect(first).toBeDefined();
    expect(investmentHistory([first!, first!]).observationCount).toBe(1);
    const filtered = investmentHistory(observations, [first!.id, "9000000999"]);
    expect(filtered.observationCount).toBe(1);
    expect(filtered.rows[0]?.id).toBe(first!.id);
    expect(filtered.unmatchedMemberCount).toBe(1);
    expect(filtered.rows.some((row) => row.principal === "0" || row.cost === "0")).toBe(false);
  });

  it("orders by reported date, registrant name, then observation id", () => {
    const { history } = historyFrom();
    const dates = history.rows.map((row) => row.reportedDate);
    expect([...dates].sort()).toEqual(dates);
    const sameDate = history.rows.filter((row) => row.reportedDate === "2099-01-31");
    expect(sameDate.map((row) => row.registrantName)).toEqual(["TEST BDC A", "TEST BDC B", "TEST BDC C", "TEST BDC D"]);
    expect(sameDate.map((row) => row.id)).toEqual(["9000000110", "9000000126", "9000000118", "9000000102"]);

    const tied = assembleReview(candidate(), {
      ...emptyPayload(),
      lines: [
        line(0),
        { ...line(0), position_observation_id: "9000000002", accession_number: "0000000000-99-000002" },
        { ...line(0), position_observation_id: "9000000001", accession_number: "0000000000-99-000001" },
      ],
      names: [{ registrant_cik: CIKS[0], name_raw: "TEST BDC D" }],
    });
    const ordered = investmentHistory(tied.groups.flatMap((group) => group.observations));
    expect(ordered.rows.map((row) => row.id)).toEqual(["9000000001", "9000000002", "9000000100"]);
  });

  it("marks a change only for the same registrant and the exact disclosed name", () => {
    const { history } = historyFrom();
    const series = history.rows.filter((row) =>
      row.registrantCik === "9999999901" && row.disclosedName === "Geo Parent Corporation",
    );
    expect(series.map((row) => row.id)).toEqual(["9000000100", "9000000104"]);
    expect(series[0]?.changes).toEqual([]);
    expect(series[1]?.changes.map((change) => change.field).sort()).toEqual(["interestRate", "principal"]);
    expect(series[1]?.changes.find((change) => change.field === "principal")).toEqual({
      field: "principal",
      previous: `TEST-P-0 · ${CURRENCY_NOTE}`,
      current: `TEST-P-4 · ${CURRENCY_NOTE}`,
    });
    expect(series[1]?.changes.find((change) => change.field === "interestRate")).toEqual({
      field: "interestRate",
      previous: "Not stored",
      current: "TEST-RATE",
    });
    const otherRegistrant = history.rows.find((row) => row.id === "9000000108");
    const otherName = history.rows.find((row) => row.id === "9000000102");
    expect(otherRegistrant?.disclosedName).toBe("Geo Parent Corporation");
    expect(otherRegistrant?.registrantCik).toBe("9999999902");
    expect(otherRegistrant?.changes).toEqual([]);
    expect(otherName?.disclosedName).toBe("Geo Parent Corporation, First Lien 1");
    expect(otherName?.changes).toEqual([]);
    expect(history.rows.every((row) => row.changes.every((change) => change.previous !== change.current))).toBe(true);
  });

  it("leaves a missing amount unknown or not stored and does not invent maturity, identity, or a filing url", () => {
    const { model, history } = historyFrom();
    expect(history.rows.every((row) => row.cost === "Not stored")).toBe(true);
    expect(history.rows.every((row) => row.fairValue === "Not stored")).toBe(true);
    expect(history.rows.every((row) => row.spread === "Not stored")).toBe(true);
    expect(history.rows.every((row) => row.maturity === "Not stored")).toBe(true);
    expect(history.rows.every((row) => row.acquisitionDate === "Not stored")).toBe(true);
    expect(history.rows.filter((row) => row.percentOfNetAssets === "TEST-NAV")).toHaveLength(1);
    expect(history.rows.filter((row) => row.percentOfNetAssets === "Not stored")).toHaveLength(31);
    expect(history.rows.some((row) => row.cost === "0" || row.fairValue === "0" || row.principal === "0")).toBe(false);
    expect(history.rows.find((row) => row.id === "9000000131")?.documentUrl).toBeNull();
    expect(history.rows.filter((row) => row.documentUrl === FILING_URL)).toHaveLength(31);
    expect(history.rows.every((row) => row.instrumentResolution === "Not yet resolved")).toBe(true);
    expect(model.legalEntity).toBe("Not yet resolved");
    expect(model.economicGroup).toBe("Not yet resolved");
    expect(model.issuerCik).toBe("Not stored");
    expect(model.lei).toBe("Not stored");
    const notes = historyCoverageNotes(history, { legalEntity: model.legalEntity, economicGroup: model.economicGroup });
    expect(notes).toContain("Maturity is not stored for these observations.");
    expect(notes).toContain("Acquisition date is not stored for these observations.");
    expect(notes).toContain("Legal entity is unresolved.");
    expect(notes).toContain("Economic group is unresolved.");
    expect(notes).toContain("Instrument identity is unresolved.");
    expect(notes.join(" ")).not.toMatch(/same investment|same instrument|credit signal|one company|one borrower/i);

    const unknownMaturity = assembleReview(candidate(), {
      ...emptyPayload(),
      lines: [line(0)],
      names: [{ registrant_cik: CIKS[0], name_raw: "TEST BDC D" }],
      maturity: [{ position_observation_id: "9000000100", maturity_source: "UNKNOWN", maturity_raw: null }],
    });
    const unknownHistory = investmentHistory(unknownMaturity.groups.flatMap((group) => group.observations));
    expect(unknownHistory.rows[0]?.maturity).toBe("Unknown");
    expect(historyCoverageNotes(unknownHistory, { legalEntity: "Not yet resolved", economicGroup: "Not yet resolved" }))
      .toContain("Maturity is Unknown for these observations.");
  });

  it("renders one row per observation, stored filing links, and missing links without a fabricated url", () => {
    const { model } = historyFrom();
    render(<EntityReview model={model} />);
    const history = screen.getByRole("region", { name: "Investment history" });
    expect(within(history).getByText(HISTORY_EXPLANATION)).toBeInTheDocument();
    expect(within(within(history).getByText("Disclosed-name variants").parentElement as HTMLElement).getByText("4")).toBeInTheDocument();
    expect(within(within(history).getByText("Source observations").parentElement as HTMLElement).getByText("32")).toBeInTheDocument();
    expect(within(within(history).getByText("BDC registrant contexts").parentElement as HTMLElement).getByText("4")).toBeInTheDocument();
    expect(within(within(history).getByText("Reporting periods").parentElement as HTMLElement).getByText("8")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Investment history" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(33);
    expect(within(table).getAllByText("Geo Parent Corporation", { exact: true })).toHaveLength(8);
    expect(within(table).getAllByText("Geo Parent Corporation, First Lien", { exact: true })).toHaveLength(8);
    expect(within(table).getAllByText("Geo Parent Corporation, First Lien 1", { exact: true })).toHaveLength(8);
    expect(within(table).getAllByText("Geo Parent Corporation, First Lien 2", { exact: true })).toHaveLength(8);
    expect(within(rows[1] as HTMLElement).getByText("2099-01-31")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("TEST BDC A")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("CIK 9999999902")).toBeInTheDocument();
    expect(within(table).getAllByText("Not stored").length).toBeGreaterThan(0);
    expect(within(table).getByText("TEST-NAV")).toBeInTheDocument();
    expect(within(table).getAllByText("Changed").length).toBeGreaterThan(0);
    expect(within(table).getByText(`Previous: TEST-P-0 · ${CURRENCY_NOTE}`)).toBeInTheDocument();
    expect(within(table).getByText(`Current: TEST-P-4 · ${CURRENCY_NOTE}`)).toBeInTheDocument();

    const links = within(table).getAllByRole("link", { name: "SEC filing" });
    expect(links).toHaveLength(31);
    for (const link of links) expect(link).toHaveAttribute("href", FILING_URL);
    expect(within(table).getAllByText("TEST-ONLY.htm").length).toBeGreaterThan(0);
    expect(within(table).getByText("0000000000-99-000031")).toBeInTheDocument();
    const missing = within(table).getByText(FILING_LINK_MISSING);
    expect(missing.closest("tr")).not.toBeNull();
    expect(within(missing.closest("tr") as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.test/ })).not.toBeInTheDocument();
    expect(screen.getByText("Maturity is not stored for these observations.")).toBeInTheDocument();
    expect(screen.getByText("Legal entity is unresolved.")).toBeInTheDocument();
    expect(screen.getByText("Instrument identity is unresolved.")).toBeInTheDocument();
    expect(screen.queryByText(/one company|one borrower|credit signal|same investment/i)).not.toBeInTheDocument();
  });
});
