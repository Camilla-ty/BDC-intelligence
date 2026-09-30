import { StateText } from "@/components/StateText";

export function StateLegend() {
  return (
    <p className="mt-1 max-w-3xl text-xs text-muted">
      <StateText text="Unknown" /> means the disclosure does not contain the fact.{" "}
      <StateText text="Unavailable" /> means the release is empty.{" "}
      <StateText text="Unobserved" /> means the date or registrant is outside the stored set.{" "}
      <StateText text="Blocked" /> means this screen does not calculate the figure.
    </p>
  );
}
