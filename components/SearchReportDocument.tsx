import React from 'react';
import { SearchResult } from '../types';
import { formatSimilarity, similarityTier, SIMILARITY_NOTICE } from '../utils/similarityPresentation';
import { imageObservations } from '../utils/imageObservations';

export interface SearchReportProps {
  results: SearchResult[]; probeImage: string; analysis: string; auditLogId: string; officerId: string;
  generatedAt: Date; reference: string;
}

export const SearchReportDocument: React.FC<SearchReportProps> = props => {
  const observations = imageObservations(props.analysis);
  return <article className="print-document report-sheet">
    <div className="report-masthead"><div><img className="lunar-report-logo" src="/logo/lunar-vision-dark.png" alt="Lunar Vision" /><span className="report-eyebrow">LUNAR VISION / ANALYST WORKSPACE</span><h1>Investigation report</h1><p>Search session record · Unverified provider output</p></div><span className="report-classification">CONFIDENTIAL</span></div>
    <div className="report-metadata"><div><small>Report reference</small><strong>{props.reference}</strong></div><div><small>Generated · Africa/Lagos</small><strong>{props.generatedAt.toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</strong></div><div><small>Review status</small><strong>REVIEW: {props.results.length ? 'REQUIRED' : 'NO CANDIDATES'}</strong></div></div>
    <div className="report-body">
      <section className="report-notice"><strong>Interpretation & limitations</strong><p>{SIMILARITY_NOTICE}</p><p>Age estimation is not displayed. Appearance is not verified age evidence. This export does not certify identity or record a completed analyst review.</p></section>
      <section><h2><span>01</span> Source & provenance</h2><div className="report-source"><img src={/^(data:|https?:|\/)/.test(props.probeImage) ? props.probeImage : `data:image/jpeg;base64,${props.probeImage}`} alt="Uploaded source"/><dl><dt>Search session</dt><dd>Search session: {props.auditLogId || 'Not recorded'}</dd><dt>Requested by</dt><dd>Requested by: {props.officerId || 'Not recorded'}</dd><dt>Returned records</dt><dd>{props.results.length} unverified candidate record(s)</dd><dt>Time reference</dt><dd>Generation time only; search time is held in the original audit record.</dd></dl></div></section>
      <div className="report-candidates"><h2><span>02</span> Candidate records</h2>{!props.results.length && <section className="report-empty">No candidate records were returned for this search. This does not establish whether a person is registered or absent from the database.</section>}{props.results.map((result, index) => <section className="report-candidate" key={`${result.suspect.faceToken}-${index}`}><div className="report-candidate-heading"><div><small>RECORD {String(index + 1).padStart(2, '0')} · {similarityTier(result.matchType)}</small><h3>{result.suspect.name}</h3></div><div className="report-score"><small>Provider similarity</small><strong>{formatSimilarity(result.confidence)}</strong></div></div><div className="report-candidate-body"><img src={result.suspect.imageUrl} alt="Source record portrait"/><dl><dt>Record identifier</dt><dd>{result.suspect.nin || 'Not recorded'}</dd><dt>Source allegation</dt><dd>{result.suspect.crime || 'Not recorded'}</dd><dt>Recorded location</dt><dd>{result.suspect.location || 'Not recorded'}</dd><dt>Source status</dt><dd>{result.suspect.status || 'Not recorded'} — source metadata, not identification</dd></dl></div></section>)}</div>
      <section><h2><span>03</span> Image observations</h2><p className="report-muted">AI generated · Unverified · Image conditions only</p>{observations.unavailable ? <p>No usable automated observations are available. Review the source image manually.</p> : <ul>{observations.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}</section>
      <section><h2><span>04</span> Analyst follow-up</h2><ol><li>Check original source provenance and independent evidence.</li><li>Record discrepancies, limitations and rationale using analyst review.</li><li>Consult the linked case timeline for saved reviews; this search export does not substitute for the case record.</li></ol></section>
    </div><div className="print-footer report-footer"><strong>LUNAR VISION</strong><span>{props.reference} · Generated report / Human review required</span></div>
  </article>;
};
