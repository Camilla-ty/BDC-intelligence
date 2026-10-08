export const LOGIN_PATH = "/login";
export const SIGNED_IN_PATH = "/account";
export const AUTH_CALLBACK_PATH = "/auth/callback";

export const CODE_SENT_MESSAGE = "If the address can receive email, a sign-in code is on its way. Enter it below.";
export const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const INVALID_CODE_MESSAGE = "Enter the code from the email, digits only.";
export const SEND_FAILED_MESSAGE = "A code could not be sent right now. Wait a minute and try again.";
export const VERIFY_FAILED_MESSAGE = "That code is not valid or has expired. Check the code or request a new one.";
export const AUTH_UNAVAILABLE_MESSAGE = "Sign-in is not available right now.";
export const OAUTH_FAILED_MESSAGE = "Microsoft sign-in could not be started right now. Wait a minute and try again.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
// Supabase lets a project set the email code length between 6 and 10 digits.
const CODE_PATTERN = /^[0-9]{6,10}$/;

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/\s+/g, "");
  return CODE_PATTERN.test(code) ? code : null;
}
