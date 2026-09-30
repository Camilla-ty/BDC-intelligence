"use client";

import { usePathname } from "next/navigation";

export function SectionHeading() {
  const path = usePathname() ?? "";
  const label = path.startsWith("/portfolios")
    ? "BDC portfolios"
    : path.startsWith("/maturity")
      ? "Maturity wall"
      : path.startsWith("/market")
        ? "Market coverage"
        : "Find Borrowers";
  return <p className="text-xs uppercase tracking-wider text-muted">{label}</p>;
}
