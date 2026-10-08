// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  cikNumeric,
  loadArccBdcFlowOnlyCount,
  loadBdcFlowFilingRefsByAccession,
} from "@/server/load-arcc-bdc-filings";

describe("load-arcc-bdc-filings", () => {
  it("pads CIK for registrant_ciks membership as a numeric value", () => {
    expect(cikNumeric("0001287750")).toBe(1287750);
  });

  it("queries admin.filing_inventory by exact accession list under admin_reader", async () => {
    const executeSqlImpl = vi.fn(async (sql: string) => {
      expect(sql).toMatch(/SET ROLE admin_reader/);
      expect(sql).toMatch(/FROM admin\.filing_inventory/);
      expect(sql).toMatch(/accession_number IN \('0001628280-26-050307', '0001104659-26-106734'\)/);
      expect(sql).not.toMatch(/\bFROM\s+registry\./i);
      return {
        ok: true,
        text: JSON.stringify([
          { filing_id: 42, accession_number: "0001628280-26-050307" },
        ]),
      };
    });
    const { refs, error } = await loadBdcFlowFilingRefsByAccession(
      ["0001628280-26-050307", "0001104659-26-106734", "0001628280-26-050307"],
      { executeSqlImpl },
    );
    expect(error).toBeNull();
    expect(refs).toEqual([{ filingId: 42, accessionNumber: "0001628280-26-050307" }]);
  });

  it("surfaces inventory read failures without inventing refs", async () => {
    const { refs, error } = await loadBdcFlowFilingRefsByAccession(["0001628280-26-050307"], {
      executeSqlImpl: async () => ({ ok: false, text: "db down" }),
    });
    expect(refs).toEqual([]);
    expect(error).toMatch(/inventory could not be read/);
  });

  it("counts ARCC-linked BDC Flow-only filings separately from the SEC list", async () => {
    const executeSqlImpl = vi.fn(async (sql: string) => {
      expect(sql).toMatch(/1287750 = ANY\(registrant_ciks\)/);
      expect(sql).toMatch(/NOT \(accession_number = ANY/);
      return { ok: true, text: "5" };
    });
    const { count, error } = await loadArccBdcFlowOnlyCount(["0001628280-26-050307"], {
      executeSqlImpl,
    });
    expect(error).toBeNull();
    expect(count).toBe(5);
  });
});
