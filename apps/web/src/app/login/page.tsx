import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { SIGNED_IN_PATH } from "@/lib/auth-input";
import { getCurrentUser } from "@/server/auth/current-user";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect(SIGNED_IN_PATH);
  return (
    <section>
      <h1 className="text-xl font-extrabold">Sign in</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Enter your email address. We send a one-time code; there is no password. A new address is registered by the same step.
      </p>
      <LoginForm />
    </section>
  );
}
