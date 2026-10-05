import { describe, expect, it } from "vitest";
import {
  DURABLE_WRITE_REFUSED,
  durableReviewSql,
  evidenceSetSql,
  externalEvidenceSql,
  internalEvidenceSql,
  noteSql,
  openCandidateSql,
  parseDurableLoad,
  reviewWritesAllowed,
} from "@/lib/review-durable";

const forbidden = /\b(INSERT\s+INTO\s+(obs|evidence|raw|identity|resolution|ops)\.|UPDATE\s|DELETE\s+FROM|CREATE\s+LEGAL)/i;

describe("durable review sql", () => {
  it("refuses hosted writes and reads only through the reader role", () => {
    expect(reviewWritesAllowed(undefined)).toBe(true);
    expect(reviewWritesAllowed("   ")).toBe(true);
    expect(reviewWritesAllowed("postgres://database.example/postgres")).toBe(false);
    expect(DURABLE_WRITE_REFUSED).toMatch(/not enabled/);
    const sql = durableReviewSql("geo-parent-corporation");
    expect(sql).toMatch(/SET ROLE bdc_reader/);
    expect(sql).toMatch(/to_regclass\('review\.current_candidate'\)/);
    expect(sql).not.toMatch(forbidden);
    expect(sql).not.toMatch(/review_writer/);
    expect(() => durableReviewSql("Geo Parent")).toThrow(/cannot be queried/);
  });

  it("writes only through review functions", () => {
    const external = externalEvidenceSql({
      candidateId: "15",
      sourceType: "COMPANY_WEBSITE",
      title: "TEST SOURCE TITLE",
      sourceUrl: "https://example.test/source",
      documentDate: "2099-04-01",
      excerpt: "TEST EXCERPT",
      noteText: "TEST INTERPRETATION",
      positionObservationId: null,
      createdBy: "TEST RESEARCHER",
    });
    expect(external).toMatch(/SET ROLE review_writer/);
    expect(external).toMatch(/review\.add_external_evidence/);
    expect(external).toMatch(/review\.add_note/);
    expect(external).not.toMatch(forbidden);
    expect(noteSql({ candidateId: "15", evidenceItemId: "4", text: "TEST INTERPRETATION", createdBy: "TEST RESEARCHER" })).toMatch(/review\.add_note/);
    expect(internalEvidenceSql({
      candidateId: "15",
      title: "Stored SEC observation",
      positionObservationId: "9000000001",
      evidenceId: "42",
      createdBy: "TEST RESEARCHER",
    })).toMatch(/review\.add_internal_evidence/);
    const grouped = evidenceSetSql({ candidateId: "15", title: "TEST EVIDENCE SET", evidenceItemIds: ["4", "5"], createdBy: "TEST RESEARCHER" });
    expect(grouped).toMatch(/review\.add_evidence_set/);
    expect(grouped).toMatch(/review\.add_set_member/);
    expect(grouped).not.toMatch(forbidden);
    const opened = openCandidateSql({
      caseKey: "test-source-case",
      title: "TEST SOURCE CASE",
      createdBy: "TEST RESEARCHER",
      positionObservationIds: ["9000000001", "9000000002"],
    });
    expect(opened).toMatch(/review\.open_candidate/);
    expect(opened).toMatch(/review\.add_member/);
    expect(opened).not.toMatch(/MATCHED|SAME|DEFERRED/);
    expect(() => externalEvidenceSql({
      candidateId: "15",
      sourceType: "INTERNAL_SEC_FILING",
      title: "TEST",
      sourceUrl: "https://example.test/source",
      documentDate: "",
      excerpt: "TEST EXCERPT",
      noteText: "",
      positionObservationId: null,
      createdBy: "TEST RESEARCHER",
    })).toThrow(/cannot be queried/);
  });

  it("parses a stored case without turning a note into an excerpt", () => {
    const loaded = parseDurableLoad({
      deployed: true,
      candidate: {
        candidate_id: 15,
        case_key: "test-source-case",
        title: "TEST SOURCE CASE",
        status: "OPEN",
        created_by: "TEST RESEARCHER",
        created_at: "2099-06-01T00:00:00.000Z",
      },
      members: [{
        position_observation_id: 9000000001,
        position_evidence_id: 42,
        disclosed_line_text: "TEST SOURCE A",
      }],
      items: [{
        evidence_item_id: 4,
        origin: "EXTERNAL",
        source_type: "COMPANY_WEBSITE",
        title: "TEST SOURCE TITLE",
        source_url: "https://example.test/source",
        document_date: "2099-04-01",
        retrieved_at: "2099-06-01T00:00:00.000Z",
        relevant_excerpt: "TEST EXCERPT",
        stored_line_text: null,
        position_observation_id: null,
        filing_document_id: null,
        evidence_id: null,
        locator_type: null,
        html_row_ordinal: null,
        html_slot_ordinal: null,
        created_by: "TEST RESEARCHER",
        created_at: "2099-06-01T00:00:00.000Z",
        source_trust: "RESEARCHER_ADDED_SOURCE",
      }],
      notes: [{
        note_id: 9,
        evidence_item_id: 4,
        note_text: "TEST INTERPRETATION",
        created_by: "TEST RESEARCHER",
        created_at: "2099-06-01T00:00:00.000Z",
      }],
      sets: [{ evidence_set_id: 3, title: "TEST EVIDENCE SET", description: null, created_by: "TEST RESEARCHER", created_at: "2099-06-01T00:00:00.000Z" }],
      memberships: [{ evidence_set_id: 3, evidence_item_id: 4, created_by: "TEST RESEARCHER", created_at: "2099-06-01T00:00:00.000Z" }],
    });
    expect(loaded.deployed).toBe(true);
    if (!loaded.deployed || loaded.candidate == null) return;
    expect(loaded.candidate.status).toBe("OPEN");
    expect(loaded.candidate.members).toEqual([{ positionObservationId: "9000000001", evidenceId: "42", disclosedLine: "TEST SOURCE A" }]);
    expect(loaded.candidate.state.items[0]?.relevantExcerpt).toBe("TEST EXCERPT");
    expect(loaded.candidate.state.notes[0]?.text).toBe("TEST INTERPRETATION");
    expect(loaded.candidate.state.items[0]?.relevantExcerpt).not.toBe(loaded.candidate.state.notes[0]?.text);
    expect(loaded.candidate.state.sets[0]?.evidenceIds).toEqual(["4"]);
    expect(loaded.candidate.state.decisions).toEqual([]);
    expect(loaded.candidate.state.legalEntitiesCreated).toBe(0);
    expect(parseDurableLoad({ deployed: false }).deployed).toBe(false);
  });
});
