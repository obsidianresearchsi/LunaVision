/** Presentation guard: generated descriptions are unverified, never demographic evidence. */
export function imageObservations(analysis: string): { notes: string[]; unavailable: boolean } {
  const unavailable = !analysis?.trim() || /unavailable|error|api.?key|quota|rate limit|pending|try again|failed|no additional details/i.test(analysis);
  const excluded = /\bage\b|\byears?\b|ethnic|race|nationality|heritage|descent|religion|gender|emotion|mood|demeanor|criminal|kinship|familial|psycholog|identity|threat|ancestry|male|female/i;
  const notes = unavailable ? [] : analysis.split('\n')
    .map(line => line.replace(/^[*#\s\d.)-]+/, '').trim())
    .filter(line => line && !excluded.test(line) && /light|glare|blur|crop|occlu|resolution|shadow|exposure|contrast|pixel|image context/i.test(line))
    .slice(0, 8);
  return { notes, unavailable: unavailable || notes.length === 0 };
}
