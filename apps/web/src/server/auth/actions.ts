"use server";

import { redirect } from "next/navigation";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  CODE_SENT_MESSAGE,
  INVALID_CODE_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  LOGIN_PATH,
  SEND_FAILED_MESSAGE,
  SIGNED_IN_PATH,
  VERIFY_FAILED_MESSAGE,
  normalizeCode,
  normalizeEmail,
} from "@/lib/auth-input";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type AuthActionResult = { ok: true; message: string } | { ok: false; error: string };

// Provider errors are never returned or logged: they can reveal account state or carry tokens.

export async function requestOtp(email: string): Promise<AuthActionResult> {
  const address = normalizeEmail(email);
  if (address == null) return { ok: false, error: INVALID_EMAIL_MESSAGE };
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase == null) return { ok: false, error: AUTH_UNAVAILABLE_MESSAGE };
    const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (error) return { ok: false, error: SEND_FAILED_MESSAGE };
    return { ok: true, message: CODE_SENT_MESSAGE };
  } catch {
    return { ok: false, error: SEND_FAILED_MESSAGE };
  }
}

// The destination is fixed; this action accepts no redirect target.
export async function verifyOtp(email: string, token: string): Promise<AuthActionResult> {
  const address = normalizeEmail(email);
  if (address == null) return { ok: false, error: INVALID_EMAIL_MESSAGE };
  const code = normalizeCode(token);
  if (code == null) return { ok: false, error: INVALID_CODE_MESSAGE };
  let verified = false;
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase == null) return { ok: false, error: AUTH_UNAVAILABLE_MESSAGE };
    const { data, error } = await supabase.auth.verifyOtp({ email: address, token: code, type: "email" });
    verified = !error && data.session != null;
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, error: VERIFY_FAILED_MESSAGE };
  redirect(SIGNED_IN_PATH);
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase != null) await supabase.auth.signOut();
  } catch {
    // auth-js removes the local session cookies even when the server-side revoke fails.
  }
  redirect(LOGIN_PATH);
}
