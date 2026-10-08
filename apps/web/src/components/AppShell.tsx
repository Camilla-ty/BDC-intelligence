import Link from "next/link";
import { PrimaryNav } from "@/components/PrimaryNav";
import { SectionHeading } from "@/components/SectionHeading";
import { StateLegend } from "@/components/StateLegend";
import { LOGIN_PATH } from "@/lib/auth-input";

export type AppShellNav = {
  signedIn: boolean;
  isAdmin: boolean;
};

export function AppShell({
  children,
  signedIn,
  isAdmin,
}: {
  children: React.ReactNode;
} & AppShellNav) {
  const homeHref = signedIn ? "/borrowers" : LOGIN_PATH;
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-b border-line bg-navy text-white md:w-56 md:border-b-0 md:border-r">
        <Link href={homeHref} className="flex items-center gap-3 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[10px] font-extrabold text-navy">
            BDC
          </span>
          <span className="text-xs font-extrabold tracking-[0.14em]">BDC INTELLIGENCE</span>
        </Link>
        <PrimaryNav signedIn={signedIn} isAdmin={isAdmin} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-white px-4 py-3 sm:px-6">
          <SectionHeading />
          <StateLegend />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
