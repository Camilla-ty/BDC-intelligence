import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";

export function MaturityText({
  maturity,
  source,
  documentUrl,
}: {
  maturity: string;
  source: string | null;
  documentUrl: string | null;
}) {
  return (
    <>
      <StateText text={maturity} />
      {source ? <span className="text-muted"> · {source}</span> : null}
      {source && documentUrl ? (
        <span className="text-muted"> · <SecLink href={documentUrl}>Filing document</SecLink></span>
      ) : null}
    </>
  );
}
