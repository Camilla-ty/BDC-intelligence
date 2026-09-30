"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/borrowers", label: "Borrowers" },
  { href: "/portfolios", label: "Portfolios" },
  { href: "/maturity", label: "Maturity" },
  { href: "/market", label: "Coverage" },
] as const;

export function PrimaryNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Primary" className="flex flex-wrap gap-1 px-2 pb-3 md:flex-col md:pb-0">
      {ITEMS.map((item) => {
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
