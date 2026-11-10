import { activityService } from './activityService';
import { caseService } from './caseService';
import { CaseStatus, SearchResult } from '../types';
import { formatSimilarity, similarityTier } from '../utils/similarityPresentation';

export const REVIEW_OUTCOMES = {
  NEEDS_MORE_EVIDENCE: 'Needs more evidence',
  EXCLUDED: 'Excluded from this investigation',
  REVIEWED_NO_CONCLUSION: 'Reviewed — no identity conclusion'
} as const;
export type ReviewOutcome = keyof typeof REVIEW_OUTCOMES;
export interface AnalystReviewInput {
  caseId: string; auditLogId: string; officerId: string; candidate: SearchResult;
  outcome: ReviewOutcome; rationale: string; acknowledgedLimitations: boolean;
}

/** Append review reasoning using existing case notes and NOTE_ADDED activities. */
export async function recordAnalystReview(input: AnalystReviewInput) {
  if (!input.caseId || !input.auditLogId.trim() || !input.officerId.trim() || !input.candidate.suspect.faceToken) {
    throw new Error('A case, original search session, reviewer, and candidate reference are required.');
  }
  if (!Object.hasOwn(REVIEW_OUTCOMES, input.outcome)) throw new Error('Choose a review outcome.');
  if (input.rationale.trim().length < 10) throw new Error('Provide a review rationale of at least 10 characters.');
  if (!input.acknowledgedLimitations) throw new Error('Acknowledge the limitations of the similarity score.');
  const caseFile = await caseService.getCase(input.caseId);
  if (caseFile.status === CaseStatus.CLOSED) throw new Error('This case is closed. Choose an active case for the review.');
  const note = [
    '[ANALYST REVIEW / v1]',
    `Outcome: ${REVIEW_OUTCOMES[input.outcome]}`,
    `Search session: ${input.auditLogId}`,
    `Candidate record: ${input.candidate.suspect.faceToken}`,
    `Provider: Face++ | Similarity: ${formatSimilarity(input.candidate.confidence)}`,
    `Raw provider similarity: ${formatSimilarity(input.candidate.confidence) === 'Unavailable' ? 'Unavailable' : String(input.candidate.confidence)} (0–100 scale)`,
    `Provider tier: ${similarityTier(input.candidate.matchType)}`,
    `Reviewer: ${input.officerId}`,
    'Limitations acknowledged: similarity is not identity probability, kinship evidence, or a threat assessment.',
    'Review rationale / independent evidence:',
    input.rationale.trim(),
    'This note records a human review. It does not confirm identity, link a subject, or change the provider score.'
  ].join('\n');
  return activityService.addNote(input.caseId, input.officerId, note);
}
