import React, { FormEvent, useState } from 'react';
import { supabase } from '../services/supabase';

export default function AgencyAccountIssuer({ workspaceId, agencyName }: { workspaceId: string; agencyName: string }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(false);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const input = new FormData(form);
    setBusy(true);
    setError('');
    setLink('');
    setExisting(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Sign in again to issue an account.');
      const response = await fetch('/api/agency-accounts', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, email: input.get('email'), role: input.get('role'), verified: input.has('verified') }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Account issuance is unavailable.');
      if (result?.existing === true) setExisting(true);
      else if (typeof result?.setupLink === 'string') setLink(result.setupLink);
      else throw new Error('The server did not return account setup details.');
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account issuance failed.');
    } finally { setBusy(false); }
  }

  return <>
    <h2>Issue an account for {agencyName}</h2>
    <p>Create an account and share its one-time password setup link with the verified recipient through your agency's approved channel.</p>
    <form onSubmit={event => void issue(event)}>
      <label>Recipient email<input name="email" type="email" required maxLength={254} disabled={busy} /></label>
      <label>Role<select name="role" disabled={busy}><option value="member">Member</option><option value="admin">Agency administrator</option></select></label>
      <label className="lv-verify-recipient"><input name="verified" type="checkbox" required disabled={busy} /> I verified the recipient and their email address.</label>
      <button type="submit" disabled={busy}>{busy ? 'Issuing account...' : 'Issue account'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {existing && <p role="status">Agency access granted. The recipient can use their existing sign-in.</p>}
    {link && <div>
      <p role="status">Account issued. Share this link only with the verified recipient. It expires and can be used once.</p>
      <label>Private setup link<input value={link} readOnly onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="lv-secondary" onClick={() => setLink('')}>Hide setup link</button>
    </div>}
  </>;
}
