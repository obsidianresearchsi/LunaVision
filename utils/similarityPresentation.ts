/** Presentation of legacy provider tiers; never an identity or family conclusion. */
export function similarityTier(type: string): string {
  if (type === 'EXACT') return 'Higher similarity';
  if (type === 'RELATIVE') return 'Lower similarity';
  return 'Unclassified similarity';
}

export function formatSimilarity(score: number): string {
  return Number.isFinite(score) && score >= 0 && score <= 100 ? `${score.toFixed(1)} / 100` : 'Unavailable';
}

export const SIMILARITY_NOTICE = 'Provider similarity scores are not probabilities of identity, evidence of kinship, or threat assessments. Independent evidence and human review are required.';
