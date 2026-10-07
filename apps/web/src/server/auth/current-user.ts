import { createSupabaseServerClient } from "@/server/auth/supabase";

export type CurrentUser = { id: string; email: string | null };

// getUser() asks the Auth server, so a signed-out or revoked session is not trusted from cookies.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase == null) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user == null) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}
