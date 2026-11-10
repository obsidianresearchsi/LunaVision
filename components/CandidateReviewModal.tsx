import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCheck, X, Loader2, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import { Case, CaseNote, CaseStatus, SearchResult } from '../types';
import { caseService } from '../services/caseService';
import { recordAnalystReview, REVIEW_OUTCOMES, ReviewOutcome } from '../services/analystReviewService';
import { formatSimilarity, similarityTier, SIMILARITY_NOTICE } from '../utils/similarityPresentation';
import { useDialogAccessibility } from './useDialogAccessibility';

export function CandidateReviewModal({ results, initialToken, auditLogId, officerId, onClose }: {
  results: SearchResult[]; initialToken?: string; auditLogId: string; officerId: string; onClose: () => void;
}) {
  const [token, setToken] = useState(initialToken || results[0]?.suspect.faceToken || '');
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [caseId, setCaseId] = useState('');
  const [outcome, setOutcome] = useState<ReviewOutcome | ''>('');
  const [rationale, setRationale] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<CaseNote | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDialogAccessibility(ref, () => { if (!saving) onClose(); });
  const candidate = results.find(result => result.suspect.faceToken === token);
  useEffect(() => {
    let active = true;
    caseService.getCases({ pageSize: 100 }).then(data => {
      if (active) setCases(data.cases.filter(item => item.status !== CaseStatus.CLOSED));
    }).catch(() => { if (active) setError('Cases could not be loaded. Close and reopen the review to retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!candidate || !outcome) return;
    setSaving(true); setError('');
    try {
      const note = await recordAnalystReview({ caseId, auditLogId, officerId, candidate, outcome, rationale, acknowledgedLimitations: acknowledged });
      setSaved(note);
    } catch (error: any) { setError(`${error.message || 'Review could not be recorded.'} If a request partially completed, check the case timeline before retrying.`); }
    finally { setSaving(false); }
  };
  return createPortal(<div className="analyst-review-backdrop" onClick={() => { if (!saving) onClose(); }}>
    <div className="analyst-review-dialog" ref={ref} role="dialog" aria-modal="true" aria-label="Analyst candidate review" tabIndex={-1} onClick={event => event.stopPropagation()}>
      <div className="analyst-review-heading"><div><ClipboardCheck size={20}/><span>Analyst review</span></div><button disabled={saving} onClick={onClose} aria-label="Close analyst review"><X size={18}/></button></div>
      <div className="analyst-review-context"><p>{SIMILARITY_NOTICE}</p><span>Search / {auditLogId || 'Missing search reference'} · Reviewer / {officerId}</span></div>
      {saved ? <div className="analyst-review-saved" role="status"><CheckCircle size={30}/><h2>Review recorded in case timeline</h2><p>{REVIEW_OUTCOMES[outcome as ReviewOutcome]}</p><p>Saved as note {saved.id} · {new Date(saved.createdAt).toLocaleString()}</p><p>No identity conclusion, subject link, or provider-score change was made.</p><button onClick={onClose}>Done</button></div> : <form onSubmit={save}>
        {error && <div className="analyst-review-error" role="alert"><AlertTriangle size={16}/><p>{error}</p></div>}
        <fieldset disabled={saving}>
          <label htmlFor="review-candidate">Candidate record</label><select id="review-candidate" value={token} onChange={event => { setToken(event.target.value); setOutcome(''); setRationale(''); setAcknowledged(false); }}>{results.map(result => <option value={result.suspect.faceToken} key={result.suspect.faceToken}>{result.suspect.name} · {formatSimilarity(result.confidence)}</option>)}</select>
          {candidate && <div className="analyst-review-score"><strong>{formatSimilarity(candidate.confidence)}</strong><span>{similarityTier(candidate.matchType)} / unverified provider candidate</span></div>}
          <label htmlFor="review-case">Save review to an active case</label><select id="review-case" required value={caseId} onChange={event => setCaseId(event.target.value)} disabled={loading || saving}><option value="">{loading ? 'Loading cases…' : 'Choose a case'}</option>{cases.map(item => <option value={item.id} key={item.id}>{item.caseNumber} · {item.title}</option>)}</select>
          {!loading && !cases.length && <p className="analyst-review-help">No active cases were found in the loaded records. Check or create an active case in the Cases workspace before recording a review.</p>}
          <label htmlFor="review-outcome">Human-review outcome</label><select id="review-outcome" required value={outcome} onChange={event => setOutcome(event.target.value as ReviewOutcome)}><option value="">Choose an outcome</option>{Object.entries(REVIEW_OUTCOMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <label htmlFor="review-rationale">Rationale and independent evidence</label><textarea id="review-rationale" required minLength={10} maxLength={6000} rows={4} value={rationale} onChange={event => setRationale(event.target.value)} placeholder="Record the evidence considered, discrepancies, and why you selected this outcome."/>
          <label className="analyst-review-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>I understand that the score does not establish identity, kinship, or threat.</span></label>
        </fieldset>
        <p className="analyst-review-help"><FileText size={13}/>Recording a review creates a case note and activity entry. It does not enroll or link a person, notify command, or alter matching.</p>
        <div className="analyst-review-actions"><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" disabled={saving || loading || !candidate || !caseId || !outcome || !acknowledged || rationale.trim().length < 10 || !auditLogId}>{saving && <Loader2 size={14} className="animate-spin"/>}{saving ? 'Recording…' : 'Record review'}</button></div>
      </form>}
    </div>
  </div>, document.body);
}
