import { StateText } from "@/components/StateText";

export function SecLink({
  href,
  children,
  missing,
}: {
  href: string | null;
  children: React.ReactNode;
  missing?: React.ReactNode;
}) {
  if (href == null) return <>{missing ?? <StateText text="Unknown" />}</>;
  return (
    <a href={href} className="break-all text-accent" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
