import { AppShell } from "@/components/AppShell";
import { getCurrentAccess } from "@/server/auth/access";

// One access lookup per shell render. PrimaryNav only receives booleans — not a client auth client.
export async function Shell({ children }: { children: React.ReactNode }) {
  const access = await getCurrentAccess();
  return (
    <AppShell signedIn={access != null} isAdmin={access?.isAdmin === true}>
      {children}
    </AppShell>
  );
}
