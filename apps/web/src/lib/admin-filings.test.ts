import { describe, expect, it } from "vitest";
import {
  listText,
  parseFilingRef,
  processingOutcomesText,
  registrantNameText,
} from "@/lib/admin-filings";

describe("admin filing display helpers", () => {
  it("keeps NULL processing outcomes as absence, not success", () => {
    expect(processingOutcomesText(null)).toBe("No linked processing rows");
    expect(processingOutcomesText(undefined)).toBe("No linked processing rows");
    expect(processingOutcomesText([])).toBe("No linked processing rows");
    expect(processingOutcomesText(["LOADED", "NOT_IN_SCOPE"])).toBe("LOADED, NOT_IN_SCOPE");
    expect(processingOutcomesText(null)).not.toMatch(/success|failed|healthy|LOADED/i);
  });

  it("preserves UNKNOWN and MULTIPLE name states without inventing a name", () => {
    expect(registrantNameText("UNKNOWN", null)).toBe("Unknown");
    expect(registrantNameText("MULTIPLE_VALUES", null)).toBe("MULTIPLE_VALUES");
    expect(registrantNameText("MULTIPLE_REGISTRANTS", null)).toBe("MULTIPLE_REGISTRANTS");
    expect(registrantNameText("REPORTED", "TEST BDC")).toBe("TEST BDC");
  });

  it("renders empty authoritative lists as Unknown", () => {
    expect(listText(null)).toBe("Unknown");
    expect(listText([])).toBe("Unknown");
    expect(listText(["10-K", "10-K/A"])).toBe("10-K, 10-K/A");
  });

  it("parses filing_id or accession and rejects invented refs", () => {
    expect(parseFilingRef("12")).toEqual({ kind: "filing_id", filingId: "12" });
    expect(parseFilingRef("0000000000-99-000001")).toEqual({
      kind: "accession",
      accession: "0000000000-99-000001",
    });
    expect(parseFilingRef("not-a-filing")).toBeNull();
  });
});
