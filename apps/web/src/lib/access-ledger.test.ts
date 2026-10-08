import { describe, expect, it } from "vitest";
import {
  currentFlagsFromEvents,
  effectiveRoleFromEvents,
  effectiveRoleFromFlags,
  normalizeUserId,
  type LedgerEvent,
} from "@/lib/access-ledger";

const t = (id: number, grantKind: LedgerEvent["grantKind"], action: LedgerEvent["action"], createdAt: string): LedgerEvent => ({
  id,
  grantKind,
  action,
  createdAt,
});

describe("access ledger", () => {
  it("treats no events as MEMBER", () => {
    expect(effectiveRoleFromEvents([])).toBe("MEMBER");
    expect(effectiveRoleFromFlags(false, false)).toBe("MEMBER");
  });

  it("treats an active PRO grant as PRO", () => {
    expect(effectiveRoleFromEvents([t(1, "PRO", "GRANT", "2099-01-01T00:00:00Z")])).toBe("PRO");
  });

  it("treats an active ADMIN grant as ADMIN", () => {
    expect(effectiveRoleFromEvents([t(1, "ADMIN", "GRANT", "2099-01-01T00:00:00Z")])).toBe("ADMIN");
  });

  it("treats ADMIN plus PRO as ADMIN", () => {
    expect(effectiveRoleFromEvents([
      t(1, "ADMIN", "GRANT", "2099-01-01T00:00:00Z"),
      t(2, "PRO", "GRANT", "2099-01-02T00:00:00Z"),
    ])).toBe("ADMIN");
    expect(effectiveRoleFromFlags(true, true)).toBe("ADMIN");
  });

  it("treats GRANT then REVOKE as inactive", () => {
    const flags = currentFlagsFromEvents([
      t(1, "PRO", "GRANT", "2099-01-01T00:00:00Z"),
      t(2, "PRO", "REVOKE", "2099-01-02T00:00:00Z"),
    ]);
    expect(flags).toEqual({ isAdmin: false, isPro: false });
    expect(effectiveRoleFromEvents([
      t(1, "PRO", "GRANT", "2099-01-01T00:00:00Z"),
      t(2, "PRO", "REVOKE", "2099-01-02T00:00:00Z"),
    ])).toBe("MEMBER");
  });

  it("treats REVOKE then GRANT as active", () => {
    expect(effectiveRoleFromEvents([
      t(1, "ADMIN", "REVOKE", "2099-01-01T00:00:00Z"),
      t(2, "ADMIN", "GRANT", "2099-01-02T00:00:00Z"),
    ])).toBe("ADMIN");
  });

  it("resolves several historical events by createdAt then id", () => {
    expect(effectiveRoleFromEvents([
      t(3, "PRO", "GRANT", "2099-01-01T00:00:00Z"),
      t(1, "PRO", "REVOKE", "2099-01-01T00:00:00Z"),
      t(2, "PRO", "GRANT", "2099-01-01T00:00:00Z"),
    ])).toBe("PRO");
    expect(effectiveRoleFromEvents([
      t(10, "ADMIN", "GRANT", "2099-06-01T00:00:00Z"),
      t(11, "ADMIN", "REVOKE", "2099-06-02T00:00:00Z"),
      t(12, "PRO", "GRANT", "2099-06-03T00:00:00Z"),
    ])).toBe("PRO");
  });

  it("accepts only a UUID user id, never an email address", () => {
    expect(normalizeUserId("00000000-0000-4000-8000-000000000001")).toBe("00000000-0000-4000-8000-000000000001");
    expect(normalizeUserId("  00000000-0000-4000-8000-000000000001  ")).toBe("00000000-0000-4000-8000-000000000001");
    expect(normalizeUserId("camilla@bdcflow.com")).toBeNull();
    expect(normalizeUserId("ADMIN")).toBeNull();
    expect(normalizeUserId("")).toBeNull();
  });
});
