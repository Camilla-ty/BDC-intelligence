import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "BDC Intelligence",
  description: "Evidence-first BDC credit intelligence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
