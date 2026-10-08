export const GRANT_KINDS = ["ADMIN", "PRO"] as const;
export const GRANT_ACTIONS = ["GRANT", "REVOKE"] as const;

export type GrantKind = (typeof GRANT_KINDS)[number];
export type GrantAction = (typeof GRANT_ACTIONS)[number];
export type EffectiveRole = "MEMBER" | "PRO" | "ADMIN";

export type LedgerEvent = {
  id: number;
  grantKind: GrantKind;
  action: GrantAction;
  createdAt: string;
};

export function effectiveRoleFromFlags(isAdmin: boolean, isPro: boolean): EffectiveRole {
  if (isAdmin) return "ADMIN";
  if (isPro) return "PRO";
  return "MEMBER";
}

// Latest event per kind wins. Sort is createdAt then id, both ascending, so the last write is current.
export function currentFlagsFromEvents(events: readonly LedgerEvent[]): { isAdmin: boolean; isPro: boolean } {
  const latest = new Map<GrantKind, GrantAction>();
  const ordered = [...events].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id - right.id;
  });
  for (const event of ordered) latest.set(event.grantKind, event.action);
  return {
    isAdmin: latest.get("ADMIN") === "GRANT",
    isPro: latest.get("PRO") === "GRANT",
  };
}

export function effectiveRoleFromEvents(events: readonly LedgerEvent[]): EffectiveRole {
  const flags = currentFlagsFromEvents(events);
  return effectiveRoleFromFlags(flags.isAdmin, flags.isPro);
}

export const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return USER_ID_PATTERN.test(id) ? id : null;
}
