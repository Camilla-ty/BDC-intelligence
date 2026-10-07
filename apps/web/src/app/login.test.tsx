import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODE_SENT_MESSAGE, VERIFY_FAILED_MESSAGE } from "@/lib/auth-input";

const actions = vi.hoisted(() => ({ requestOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/server/auth/actions", () => actions);

import { LoginForm } from "@/components/LoginForm";

afterEach(() => {
  vi.clearAllMocks();
});

describe("login form", () => {
  it("asks for an email, then a code, with no password field", async () => {
    actions.requestOtp.mockResolvedValue({ ok: true, message: CODE_SENT_MESSAGE });
    render(<LoginForm />);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    const send = screen.getByRole("button", { name: "Send code" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.test" } });
    fireEvent.click(send);
    expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();
    expect(actions.requestOtp).toHaveBeenCalledWith("user@example.test");
    expect(screen.getByRole("status")).toHaveTextContent(CODE_SENT_MESSAGE);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows a generic error for a bad code and lets the user change the email", async () => {
    actions.requestOtp.mockResolvedValue({ ok: true, message: CODE_SENT_MESSAGE });
    actions.verifyOtp.mockResolvedValue({ ok: false, error: VERIFY_FAILED_MESSAGE });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(VERIFY_FAILED_MESSAGE);
    expect(actions.verifyOtp).toHaveBeenCalledWith("user@example.test", "000000");
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("user@example.test"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
