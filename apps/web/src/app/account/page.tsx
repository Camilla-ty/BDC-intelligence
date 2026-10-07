import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth-input";
import { signOut } from "@/server/auth/actions";
import { getCurrentUser } from "@/server/auth/current-user";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (user == null) redirect(LOGIN_PATH);
  return (
    <section>
      <h1 className="text-xl font-extrabold">Signed in</h1>
      <dl className="mt-4 text-sm">
        <dt className="text-xs uppercase tracking-wider text-muted">Email</dt>
        <dd>{user.email ?? <span className="state-unknown">Unknown</span>}</dd>
      </dl>
      <form action={signOut} className="mt-6">
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
          Sign out
        </button>
      </form>
    </section>
  );
}
