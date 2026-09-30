import Link from "next/link";
import { StateText } from "@/components/StateText";

export function MissingRecord({
  message,
  href,
  label,
}: {
  message: string;
  href: string;
  label: string;
}) {
  return (
    <p className="text-sm">
      <StateText text={message} />{" "}
      <Link href={href} className="text-accent">{label}</Link>
    </p>
  );
}
