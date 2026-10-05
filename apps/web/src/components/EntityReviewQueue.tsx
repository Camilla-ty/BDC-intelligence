import Link from "next/link";
import { CANDIDATE_NOTE, NOT_RESOLVED_NOTE, type EntityReviewCandidate } from "@/lib/entity-review";

export function EntityReviewQueue({
  candidates,
  storedMembers = {},
}: {
  candidates: readonly EntityReviewCandidate[];
  storedMembers?: Readonly<Record<string, number>>;
}) {
  return (
    <article>
      <h1 className="text-lg font-semibold text-navy">Entity resolution review</h1>
      <p className="mt-2 text-sm text-muted">{CANDIDATE_NOTE}</p>
      <p className="mt-2 text-sm text-muted">{NOT_RESOLVED_NOTE}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="record-table w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Source observations</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>
                  <Link href={`/review/entities/${candidate.id}`} className="text-accent">{candidate.label}</Link>
                </td>
                <td>Borrower</td>
                <td>
                  {storedMembers[candidate.id] == null
                    ? `${candidate.status} · Researcher review required`
                    : `${candidate.status} · Review case · Resolution has not been decided`}
                </td>
                <td>{storedMembers[candidate.id] ?? candidate.descriptors.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
