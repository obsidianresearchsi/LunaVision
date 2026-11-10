import React, { useEffect, useState } from 'react';
import { ArrowRight, Shield } from 'lucide-react';
import { supabaseDb } from '../services/supabaseDb';
import { User, UserRole } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
  onPreview: () => void;
  investigationRequested?: boolean;
  previewOnly?: boolean;
}

export function Login({ onLogin, onPreview, investigationRequested = false, previewOnly = false }: LoginProps) {
  const [firstRun, setFirstRun] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (previewOnly) return;
    let current = true;
    supabaseDb.getUsers().then(users => {
      if (current) setFirstRun(users.length === 0);
    }).catch(error => console.error('Failed to check workspace users:', error));
    return () => { current = false; };
  }, [previewOnly]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || previewOnly) return;
    setError('');
    setBusy(true);
    try {
      const users = await supabaseDb.getUsers();
      if (firstRun && users.length === 0) {
        const chief: User = {
          id: 'chief_01',
          username: username.trim(),
          role: UserRole.CHIEF_COMMANDER,
          createdAt: new Date().toISOString(),
        };
        await supabaseDb.addUser(chief);
        onLogin(chief);
        return;
      }
      const user = users.find(account => account.username === username.trim());
      if (user) onLogin(user);
      else setError('No workspace account matches that username.');
    } catch {
      setError('Unable to connect to the workspace. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="eagle-auth lunar-auth">
      <section className="lunar-auth-visual" aria-label="Illustration of the Meridian Port site">
        <img src="/lunar/meridian-site.webp" alt="" />
        <span className="lunar-auth-map-label">Meridian Port / Illustrative site</span>
      </section>
      <section className="lunar-auth-panel" aria-labelledby="sign-in-title">
        <img className="lunar-auth-logo" src="/logo/lunar-vision-white.png" alt="Lunar Vision" />
        <span className="lunar-eyebrow">By Lunar Robotics</span>
        <h1 id="sign-in-title">{previewOnly ? 'Lunar Vision design preview' : firstRun ? 'Set up your workspace' : 'Operator sign-in'}</h1>
        <p>{previewOnly ? 'Explore Meridian Port with fictional camera, alert and incident data.' : firstRun ? 'Create the first commander account for this workspace.' : investigationRequested ? 'Sign in to open the EagleEye investigation tools.' : 'Use your workspace account to access Lunar Vision.'}</p>
        {!previewOnly && <>
        <form onSubmit={submit}>
          <label htmlFor="lunar-username">Workspace username</label>
          <input id="lunar-username" autoComplete="username" required value={username}
            onChange={event => setUsername(event.target.value)}
            placeholder="Enter your username" />
          <label htmlFor="lunar-password">Passphrase</label>
          <input id="lunar-password" type="password" autoComplete={firstRun ? 'new-password' : 'current-password'} required
            value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your passphrase" />
          {error && <p className="lunar-auth-error" role="alert">{error}</p>}
          <button className="lunar-button lunar-primary" type="submit" disabled={busy}>
            {busy ? 'Connecting…' : firstRun ? 'Create workspace account' : 'Sign in'} <ArrowRight size={16} />
          </button>
        </form>
        <p className="lunar-auth-note"><Shield size={15} /> Demo authentication is enabled for this workspace.</p>
        </>}
        <button className={previewOnly ? 'lunar-button lunar-primary lunar-preview-link' : 'lunar-button lunar-preview-link'} type="button" onClick={onPreview}>Explore design preview <ArrowRight size={15} /></button>
      </section>
    </main>
  );
}

