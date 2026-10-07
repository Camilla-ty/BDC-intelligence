"use client";

import { useState, useTransition } from "react";
import { requestOtp, verifyOtp } from "@/server/auth/actions";

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export function LoginForm() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestOtp(email);
      if (result.ok) {
        setNotice(result.message);
        setCode("");
        setStep("code");
      } else {
        setError(result.error);
      }
    });
  }

  function checkCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyOtp(email, code);
      if (result && !result.ok) setError(result.error);
    });
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setNotice(null);
    setError(null);
  }

  return (
    <div className="mt-6 max-w-sm">
      {step === "email" ? (
        <form onSubmit={sendCode} aria-busy={pending}>
          <label htmlFor="login-email" className="block text-xs uppercase tracking-wider text-muted">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
            className={fieldClass}
          />
          <button type="submit" disabled={pending || email.trim() === ""} className={`mt-4 ${buttonClass}`}>
            {pending ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={checkCode} aria-busy={pending}>
          {notice ? <p className="mb-4 text-sm" role="status">{notice}</p> : null}
          <p className="mb-4 text-sm text-muted">Code sent for <span className="font-semibold text-foreground">{email.trim()}</span></p>
          <label htmlFor="login-code" className="block text-xs uppercase tracking-wider text-muted">Verification code</label>
          <input
            id="login-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={pending}
            className={fieldClass}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending || code.trim() === ""} className={buttonClass}>
              {pending ? "Verifying…" : "Verify"}
            </button>
            <button type="button" onClick={changeEmail} disabled={pending} className="text-sm font-semibold text-accent underline disabled:opacity-50">
              Use a different email
            </button>
          </div>
        </form>
      )}
      {error ? <p className="mt-4 text-sm" role="alert">{error}</p> : null}
    </div>
  );
}
