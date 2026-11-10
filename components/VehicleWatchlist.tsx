import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

type Entry = {
  id: string;
  plate: string;
  reason: 'stolen' | 'watchlist';
  case_reference: string;
};

const columns = 'id,plate,reason,case_reference';
const reasons = { stolen: 'Reported stolen', watchlist: 'Agency watchlist' };

function normalize(value: string) {
  const plate = value.trim().replace(/[ -]/g, '');
  if (!/^[A-Za-z0-9]{2,12}$/.test(plate)) throw new Error('Enter 2–12 plate letters or digits. Spaces and hyphens are optional.');
  return plate.toUpperCase();
}

export function PlateWatchlistCheck({ workspaceId, initialPlate = '' }: { workspaceId: string; initialPlate?: string }) {
  const [plate, setPlate] = useState(initialPlate);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');
  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult('');
    try {
      const confirmedPlate = normalize(plate);
      const { data, error } = await supabase.from('lv_vehicle_watchlist').select(columns)
        .eq('workspace_id', workspaceId).eq('plate', confirmedPlate).is('retired_at', null).maybeSingle();
      if (error) throw new Error('The agency watchlist could not be checked.');
      const match = data as Entry | null;
      setResult(match
        ? `${confirmedPlate} matched an active entry. ${reasons[match.reason]}. Case ${match.case_reference}. Verify against the source and case record.`
        : `No active entry for ${confirmedPlate} in this agency watchlist.`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'The agency watchlist could not be checked.');
    } finally { setPending(false); }
  }

  return <form onSubmit={check}>
    <label>Verify Nigerian plate before checking<input value={plate} onChange={event => {
      setPlate(event.target.value);
      setResult('');
    }} required maxLength={20} disabled={pending} /></label>
    <button type="submit" disabled={pending}>{pending ? 'Checking…' : 'Check agency watchlist'}</button>
    {result && <p role="status">{result}</p>}
  </form>;
}

export default function VehicleWatchlist({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void supabase.from('lv_vehicle_watchlist').select(columns).eq('workspace_id', workspaceId)
      .is('retired_at', null).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (!current) return;
        setLoading(false);
        if (error) { setEntries([]); setNotice('Active entries could not be loaded.'); }
        else setEntries(data as Entry[]);
      });
    return () => { current = false; };
  }, [workspaceId, refresh]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.from('lv_vehicle_watchlist').insert({
        workspace_id: workspaceId,
        plate: normalize(String(fields.get('plate'))),
        reason: fields.get('reason'),
        case_reference: String(fields.get('case')).trim(),
      });
      if (error) throw new Error(error.code === '23505' ? 'This plate already has an active entry.' : 'The entry could not be added.');
      form.reset();
      setRefresh(previous => previous + 1);
      setNotice('Watchlist entry added.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The entry could not be added.');
    } finally { setBusy(false); }
  }

  async function retire(id: string) {
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('lv_retire_vehicle_watch', { target_id: id });
      setNotice(error ? 'The entry could not be closed. Refresh the watchlist and try again.' : 'Watchlist entry closed.');
    } finally {
      setRefresh(previous => previous + 1);
      setBusy(false);
    }
  }

  return <section className="lv-card">
    <h2>Vehicle watchlist</h2>
    <p>Register Nigerian plates tied to an agency case, then check verified plate readings against active entries.</p>
    <PlateWatchlistCheck workspaceId={workspaceId} />
    <form onSubmit={add}>
      <label>Nigerian plate<input name="plate" maxLength={20} required /></label>
      <label>Reason<select name="reason"><option value="stolen">Reported stolen</option><option value="watchlist">Agency watchlist</option></select></label>
      <label>Case reference<input name="case" maxLength={120} required /></label>
      <button type="submit" disabled={busy}>Add watchlist entry</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {loading ? <p>Loading active entries…</p> : entries.length > 0 && <h3>Recent active entries</h3>}
    {entries.map(entry => <article key={entry.id}>
      <h3>{entry.plate}</h3><p>{reasons[entry.reason]} · Case {entry.case_reference}</p>
      <button type="button" className="lv-secondary" disabled={busy || loading} onClick={() => void retire(entry.id)}>Close entry</button>
    </article>)}
  </section>;
}
