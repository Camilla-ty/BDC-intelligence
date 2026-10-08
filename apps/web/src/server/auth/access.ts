import { notFound, redirect } from "next/navigation";
import {
  effectiveRoleFromFlags,
  normalizeUserId,
  type EffectiveRole,
} from "@/lib/access-ledger";
import { LOGIN_PATH } from "@/lib/auth-input";
import { getCurrentUser, type CurrentUser } from "@/server/auth/current-user";
import { executeSql } from "@/server/sql-text";

export type CurrentAccess = {
  user: CurrentUser;
  effectiveRole: EffectiveRole;
  isAdmin: boolean;
  isPro: boolean;
};

const UNAVAILABLE_ACCESS = { isAdmin: false, isPro: false, effectiveRole: "MEMBER" as const };

function quoteUserId(userId: string): string {
  const id = normalizeUserId(userId);
  if (id == null) throw new Error("Access user cannot be queried.");
  return `'${id}'::uuid`;
}

export function currentAccessSql(userId: string): string {
  const id = quoteUserId(userId);
  return `
SET ROLE access_reader;
SET statement_timeout = '30s';
SELECT CASE
  WHEN to_regclass('access.current_access') IS NULL THEN '{"deployed":false}'::json
  ELSE COALESCE(
    (SELECT json_build_object(
       'deployed', true,
       'is_admin', is_admin,
       'is_pro', is_pro,
       'effective_role', effective_role
     ) FROM access.current_access WHERE user_id = ${id}),
    json_build_object('deployed', true, 'is_admin', false, 'is_pro', false, 'effective_role', 'MEMBER')
  )
END;
RESET ROLE;
`;
}

function parseAccessRow(text: string): { isAdmin: boolean; isPro: boolean; effectiveRole: EffectiveRole } {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return UNAVAILABLE_ACCESS;
  }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return UNAVAILABLE_ACCESS;
  const row = payload as { deployed?: unknown; is_admin?: unknown; is_pro?: unknown };
  if (row.deployed !== true) return UNAVAILABLE_ACCESS;
  const isAdmin = row.is_admin === true;
  const isPro = row.is_pro === true;
  return { isAdmin, isPro, effectiveRole: effectiveRoleFromFlags(isAdmin, isPro) };
}

export async function getCurrentAccess(): Promise<CurrentAccess | null> {
  const user = await getCurrentUser();
  if (user == null) return null;
  if (normalizeUserId(user.id) == null) return { user, ...UNAVAILABLE_ACCESS };
  const executed = await executeSql(currentAccessSql(user.id));
  const flags = executed.ok ? parseAccessRow(executed.text) : UNAVAILABLE_ACCESS;
  return { user, ...flags };
}

export async function requireAuthenticatedUser(): Promise<CurrentAccess> {
  const access = await getCurrentAccess();
  if (access == null) redirect(LOGIN_PATH);
  return access;
}

export async function requireAdmin(): Promise<CurrentAccess> {
  const access = await requireAuthenticatedUser();
  if (!access.isAdmin) notFound();
  return access;
}

export async function requireProOrAdmin(): Promise<CurrentAccess> {
  const access = await requireAuthenticatedUser();
  if (!access.isAdmin && !access.isPro) notFound();
  return access;
}
