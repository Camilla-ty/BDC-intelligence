import { cache } from "react";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type CurrentUser = { id: string; email: string | null };

// getUser() asks the Auth server, so a signed-out or revoked session is not trusted from cookies.
// React.cache dedupes within one RSC request (Shell + page guards share one lookup).
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase == null) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user == null) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
});
