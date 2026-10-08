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
        Enter your email for a one-time code, or continue with Microsoft. There is no password. A new email address is registered by the same code step.
      </p>
      <LoginForm />
    </section>
  );
}
