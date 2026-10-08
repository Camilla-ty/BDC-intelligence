import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/borrowers",
}));

import { PrimaryNav } from "@/components/PrimaryNav";

describe("PrimaryNav", () => {
  it("shows only Login when signed out", () => {
    render(<PrimaryNav signedIn={false} isAdmin={false} />);
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Borrowers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
  });

  it("shows research and Account for MEMBER/PRO, without Admin or Review", () => {
    render(<PrimaryNav signedIn isAdmin={false} />);
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("href", "/portfolios");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("href", "/maturity");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Login" })).not.toBeInTheDocument();
  });

  it("shows Admin for ADMIN users and never shows Review", () => {
    render(<PrimaryNav signedIn isAdmin />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
  });
});
