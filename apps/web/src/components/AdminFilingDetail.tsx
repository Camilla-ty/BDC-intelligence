import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import {
  cikListText,
  countText,
  listText,
  optionalText,
  processingOutcomesText,
  registrantNameText,
  type AdminFilingDetail,
} from "@/lib/admin-filings";

function JsonText({ value }: { value: unknown }) {
  if (value == null) return <StateText text="Unknown" />;
  let text: string | null = null;
  try {
    text = JSON.stringify(value);
  } catch {
    text = null;
  }
  if (text == null) return <StateText text="Unknown" />;
  return <code className="break-all text-xs">{text}</code>;
}

export function AdminFilingDetailView({ detail }: { detail: AdminFilingDetail }) {
  const { inventory: inv } = detail;
  return (
    <section>
      <p className="text-sm">
        <Link href="/admin" className="text-accent">Admin</Link>
        <span className="text-muted"> / </span>
        <Link href="/admin/filings" className="text-accent">Filing inventory</Link>
        <span className="text-muted"> / {inv.accession_number}</span>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Filing detail</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        SEC filing → registrant → attributes → documents → artifacts → processing → observations.
        Source disagreements stay visible. Absence is not treated as success.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Filing</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Accession</dt>
          <dd className="mt-1 font-semibold">{inv.accession_number}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Filing id</dt>
          <dd className="mt-1">{countText(inv.filing_id)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Registrant link</dt>
          <dd className="mt-1">{inv.registrant_link_status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">CIK</dt>
          <dd className="mt-1"><StateText text={cikListText(inv.registrant_ciks)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Registrant name</dt>
          <dd className="mt-1">
            <StateText text={registrantNameText(inv.registrant_name_state, inv.registrant_name_raw)} />
            <span className="ml-2 text-muted">({inv.registrant_name_state})</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Form (normalized)</dt>
          <dd className="mt-1"><StateText text={listText(inv.forms)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Form (raw)</dt>
          <dd className="mt-1"><StateText text={listText(inv.form_raw_values)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Filed date (normalized)</dt>
          <dd className="mt-1"><StateText text={listText(inv.filed_dates)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Filed date (raw)</dt>
          <dd className="mt-1"><StateText text={listText(inv.filed_date_raw_values)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Report period (normalized)</dt>
          <dd className="mt-1"><StateText text={listText(inv.report_periods)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Report period (raw)</dt>
          <dd className="mt-1"><StateText text={listText(inv.report_period_raw_values)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Filing recorded</dt>
          <dd className="mt-1"><StateText text={optionalText(inv.filing_recorded_at)} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Filing run id</dt>
          <dd className="mt-1"><StateText text={optionalText(inv.filing_run_id)} /></dd>
        </div>
      </dl>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Registrant links</h2>
      {detail.registrants.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No registrant link rows.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                <th scope="col" className="py-2 pr-3 font-semibold">CIK</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Name state</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Link source</th>
                <th scope="col" className="py-2 font-semibold">Evidence id</th>
              </tr>
            </thead>
            <tbody>
              {detail.registrants.map((row, index) => (
                <tr key={`${row.registrant_id ?? "none"}-${index}`} className="border-b border-line">
                  <td className="py-2 pr-3">{row.registrant_link_status}</td>
                  <td className="py-2 pr-3">
                    <StateText text={row.cik == null ? "Unknown" : String(row.cik).padStart(10, "0")} />
                  </td>
                  <td className="py-2 pr-3">
                    <StateText text={registrantNameText(row.name_state ?? "UNKNOWN", row.name_raw)} />
                  </td>
                  <td className="py-2 pr-3"><StateText text={optionalText(row.name_state)} /></td>
                  <td className="py-2 pr-3"><StateText text={optionalText(row.link_source)} /></td>
                  <td className="py-2"><StateText text={optionalText(row.evidence_id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Filing attributes</h2>
      {detail.attributes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No current filing attributes.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Attribute</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Raw</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Normalized</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Value state</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Source</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Evidence</th>
                <th scope="col" className="py-2 font-semibold">Rule / run</th>
              </tr>
            </thead>
            <tbody>
              {detail.attributes.map((row) => (
                <tr key={row.observation_id} className="border-b border-line align-top">
                  <td className="py-2 pr-3">{row.attribute_code}</td>
                  <td className="py-2 pr-3 break-all">{row.raw_value}</td>
                  <td className="py-2 pr-3 break-all">
                    <StateText
                      text={
                        row.normalized_text
                        ?? row.normalized_date
                        ?? row.normalized_timestamp
                        ?? "Unknown"
                      }
                    />
                  </td>
                  <td className="py-2 pr-3">{row.value_state}</td>
                  <td className="py-2 pr-3">
                    <StateText text={optionalText(row.source_type_code)} />
                    {row.source_stream ? <div className="text-xs text-muted">{row.source_stream}</div> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <StateText text={optionalText(row.evidence_level)} />
                    <div className="text-xs text-muted">id {optionalText(row.evidence_id)}</div>
                    <div className="text-xs text-muted">{optionalText(row.documentation_status)}</div>
                  </td>
                  <td className="py-2 text-xs">
                    rule {optionalText(row.rule_version_id)}
                    <br />
                    run {optionalText(row.run_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Named documents</h2>
      {detail.documents.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No named documents linked to this filing.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Stored URL</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Named by</th>
                <th scope="col" className="py-2 font-semibold">Artifact</th>
              </tr>
            </thead>
            <tbody>
              {detail.documents.map((row) => (
                <tr key={row.filing_document_id} className="border-b border-line align-top">
                  <td className="py-2 pr-3">{row.document_name}</td>
                  <td className="py-2 pr-3">
                    <SecLink href={row.document_url}>{row.document_url}</SecLink>
                  </td>
                  <td className="py-2 pr-3">{row.named_by}</td>
                  <td className="py-2">
                    {row.artifact_linked ? "Linked artifact present" : "No linked artifact"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Linked artifacts</h2>
      {detail.artifacts.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No linked artifacts for this filing.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Artifact</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Document</th>
                <th scope="col" className="py-2 pr-3 font-semibold">URLs</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Retrieval</th>
                <th scope="col" className="py-2 font-semibold">Checksum / storage</th>
              </tr>
            </thead>
            <tbody>
              {detail.artifacts.map((row) => (
                <tr key={`${row.artifact_id}-${row.filing_document_id}`} className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    {row.artifact_id}
                    <div className="text-xs text-muted">{row.source_type_code}</div>
                  </td>
                  <td className="py-2 pr-3">{row.document_name}</td>
                  <td className="py-2 pr-3">
                    <div><SecLink href={row.source_url}>source</SecLink></div>
                    <div><SecLink href={row.final_url}>final</SecLink></div>
                    <div><SecLink href={row.document_url}>document</SecLink></div>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    HTTP {row.http_status}
                    <br />
                    {optionalText(row.content_type)}
                    <br />
                    {row.byte_size} bytes
                    <br />
                    retrieved {row.retrieved_at}
                    {row.last_modified ? <><br />Last-Modified {row.last_modified}</> : null}
                    {row.etag ? <><br />etag {row.etag}</> : null}
                  </td>
                  <td className="py-2 text-xs break-all">
                    sha256 {row.sha256}
                    <br />
                    {row.storage_key}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Processing</h2>
      <p className="mt-2 text-sm">
        Inventory outcomes:{" "}
        {inv.processing_outcomes == null ? (
          <span className="text-muted">{processingOutcomesText(null)}</span>
        ) : (
          processingOutcomesText(inv.processing_outcomes)
        )}
        {" · "}
        processing rows: {countText(inv.processing_row_count)}
      </p>
      {detail.processing.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No linked processing rows. A named document alone is not a processing success.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Outcome</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Rule</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Detail</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Counts</th>
                <th scope="col" className="py-2 font-semibold">Run</th>
              </tr>
            </thead>
            <tbody>
              {detail.processing.map((row) => (
                <tr key={row.artifact_processing_id} className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    {row.outcome}
                    <div className="text-xs text-muted">artifact {row.artifact_id}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {row.rule_code} {row.rule_version}
                    <br />
                    {row.rule_kind}
                    <br />
                    id {row.rule_version_id}
                  </td>
                  <td className="py-2 pr-3 break-all">{row.detail}</td>
                  <td className="py-2 pr-3"><JsonText value={row.counts} /></td>
                  <td className="py-2 text-xs">
                    run {row.run_id}
                    <br />
                    <StateText text={optionalText(row.run_status)} />
                    {row.run_kind ? <><br />{row.run_kind}</> : null}
                    {row.run_started_at ? <><br />started {row.run_started_at}</> : null}
                    {row.run_finished_at ? <><br />finished {row.run_finished_at}</> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Produced observations</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">SOI row observations</dt>
          <dd className="mt-1 font-semibold">{countText(inv.soi_row_observation_count)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Position observations</dt>
          <dd className="mt-1 font-semibold">{countText(inv.position_observation_count)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">NUM fact observations</dt>
          <dd className="mt-1 font-semibold">{countText(inv.num_fact_observation_count)}</dd>
        </div>
      </dl>
    </section>
  );
}
