"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOGIN_PATH, SIGNED_IN_PATH } from "@/lib/auth-input";

type NavItem = { href: string; label: string };

function navItems(signedIn: boolean, isAdmin: boolean): NavItem[] {
  if (!signedIn) return [{ href: LOGIN_PATH, label: "Login" }];
  const items: NavItem[] = [
    { href: "/borrowers", label: "Borrowers" },
    { href: "/portfolios", label: "Portfolios" },
    { href: "/maturity", label: "Maturity" },
    { href: "/market", label: "Coverage" },
    { href: SIGNED_IN_PATH, label: "Account" },
  ];
  if (isAdmin) items.push({ href: "/admin", label: "Admin" });
  return items;
}

export function PrimaryNav({ signedIn, isAdmin }: { signedIn: boolean; isAdmin: boolean }) {
  const path = usePathname() ?? "";
  const items = navItems(signedIn, isAdmin);
  return (
    <nav aria-label="Primary" className="flex flex-wrap gap-1 px-2 pb-3 md:flex-col md:pb-0">
      {items.map((item) => {
        const current = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white ${current ? "bg-white/15" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
