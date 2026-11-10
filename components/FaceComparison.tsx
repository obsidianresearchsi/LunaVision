import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

type Comparison = { name: string; score: number; threshold: number | null };
const configured = import.meta.env.VITE_FACE_COMPARISON_ENABLED === 'true';

export default function FaceComparison({ workspaceId, gallery = false }: { workspaceId: string; gallery?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<Comparison[]>([]);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const photos = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    setResults([]);
    try {
      const reference = photos.get('reference');
      const candidates = photos.getAll('candidate');
      if (!candidates.length || candidates.length > (gallery ? 6 : 1)) throw new Error('Choose between one and six gallery photos.');
      for (const photo of [reference, ...candidates]) {
        if (!(photo instanceof File) || !['image/jpeg', 'image/png'].includes(photo.type) || photo.size === 0 || photo.size > 1_250_000) {
          throw new Error('Choose two JPEG or PNG files under 1.25 MB each.');
        }
      }
      const scores: Comparison[] = [];
      for (const candidate of candidates as File[]) {
        const { data, error } = await supabase.auth.getSession();
        controller.signal.throwIfAborted();
        if (error || !data.session) throw new Error('Sign in again to compare faces.');
        const pair = new FormData();
        pair.set('reference', reference as File);
        pair.set('candidate', candidate);
        const response = await fetch('/api/face-compare', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + data.session.access_token, 'X-Workspace-Id': workspaceId },
          body: pair,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
        });
        const output = await response.json().catch(() => null);
        if (!response.ok || typeof output?.score !== 'number') {
          throw new Error(output?.error || 'Face comparison is unavailable.');
        }
        scores.push({ name: candidate.name, score: output.score, threshold: output.threshold ?? null });
        setResults([...scores].sort((left, right) => right.score - left.score));
      }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Face comparison failed.');
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="lv-card">
    <h2>{gallery ? 'Face gallery search' : 'Face comparison'}</h2>
    {configured ? <>
      <p>{gallery ? 'Search up to six authorized gallery photos with a reference photo.' : 'Compare two authorized photos.'} Use images that clearly show one face each. Submitting sends the images to Face++ for processing.</p>
      <form onSubmit={event => void compare(event)} onChange={() => { setNotice(''); setResults([]); }}>
        <label>Reference photo<input name="reference" type="file" accept="image/jpeg,image/png" required disabled={busy} /></label>
        <label>{gallery ? 'Gallery photos' : 'Photo to compare'}<input name="candidate" type="file" multiple={gallery} accept="image/jpeg,image/png" required disabled={busy} /></label>
        <button disabled={busy}>{busy ? 'Comparing photos...' : gallery ? 'Search gallery' : 'Compare photos'}</button>
      </form>
      {notice && <p role="alert">{notice}</p>}
      {results.length > 0 && <div aria-live="polite">
        <p>Review the original photos before drawing any conclusion.</p>
        {results.map((result, index) => <p key={index}>{result.name}. Similarity score {result.score.toFixed(1)} out of 100.
          {result.threshold !== null && ' Provider reference threshold ' + result.threshold.toFixed(1) + '.'}</p>)}
      </div>}
    </> : <p>Face comparison is unavailable until the provider is connected.</p>}
  </section>;
}
