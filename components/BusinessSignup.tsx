import React, { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Mail, ShieldCheck, Video, Users } from 'lucide-react';
import { supabase } from '../services/supabase';
import '../styles/business-signup.css';

export default function BusinessSignup({ onSignIn, onGoogle, notice, externalBusy = false }: { onSignIn: () => void; onGoogle?: () => void; notice?: string; externalBusy?: boolean }) {
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || externalBusy;
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLength, setPasswordLength] = useState(0);
  const [error, setError] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const fullName = String(fields.get('full_name') ?? '').trim();
    const organization = String(fields.get('organization_name') ?? '').trim();
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    if (fullName.length < 2 || organization.length < 2 || fullName.length > 100 || organization.length > 100) {
      setError('Enter your name and business name using 2–100 characters.');
      return;
    }
    if (password.length < 12) { setError('Use a password with at least 12 characters.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const result = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: location.origin + '/business',
          data: { full_name: fullName, organization_name: organization, business_signup_version: 1 },
        },
      });
      if (result.error) throw new Error(result.error.message);
      if (!result.data.session) setConfirmationEmail(email);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your account could not be created. Please try again.');
    } finally { setSubmitting(false); }
  }

  return <main className="lv-business-signup">
    <header className="lv-signup-topbar">
      <a href="/" aria-label="Lunar Vision home"><img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="188" /></a>
      <a href="/" className="lv-signup-back"><ArrowLeft size={14} aria-hidden="true"/> Back to website</a>
    </header>
    <div className="lv-signup-shell">
      <section className="lv-signup-intro" aria-label="Business workspace benefits">
        <span className="lv-signup-eyebrow"><span/> LUNAR VISION FOR BUSINESS</span>
        <h1>Your sites.<br/>One clear view.</h1>
        <p>Bring your cameras, people and operations into one connected workspace.</p>
        <div className="lv-signup-benefits">
          <div><Video size={20} aria-hidden="true"/><span><strong>See what matters</strong><small>Connect cameras and monitor your sites.</small></span></div>
          <div><ShieldCheck size={20} aria-hidden="true"/><span><strong>Act with confidence</strong><small>Manage alerts, incidents and supporting evidence.</small></span></div>
          <div><Users size={20} aria-hidden="true"/><span><strong>Bring your team together</strong><small>Give staff the roles and access they need.</small></span></div>
        </div>
        <p className="lv-signup-industries">PORTS &amp; LOGISTICS · INDUSTRIAL SITES<br/>COMMERCIAL PROPERTY · CORPORATE CAMPUSES</p>
      </section>
      <section className="lv-signup-card" aria-labelledby="lv-signup-heading">
        {confirmationEmail ? <div className="lv-signup-confirmation">
          <span className="lv-signup-mail"><Mail size={26} aria-hidden="true"/></span>
          <span className="lv-signup-eyebrow">NEXT STEP</span>
          <h2 id="lv-signup-heading">Check your email</h2>
          <p>Check <strong>{confirmationEmail}</strong> for the next step. If confirmation is required, follow the email link to open your business workspace.</p>
          <p className="lv-signup-muted">Already have an account? Sign in with your existing password. You can also check your spam folder.</p>
          <button type="button" className="lv-signup-primary" onClick={onSignIn}>Go to sign in <ArrowRight size={16} aria-hidden="true"/></button>
          <button type="button" className="lv-signup-text-button" onClick={() => {setConfirmationEmail('');setPasswordLength(0);setShowPassword(false);}}>Use another email</button>
        </div> : <>
          <span className="lv-signup-eyebrow">GET STARTED</span>
          <h2 id="lv-signup-heading">Create your business account</h2>
          <p className="lv-signup-subtitle">A few details to make this workspace yours.</p>
          <form onSubmit={event => void submit(event)} aria-busy={busy}>
            <fieldset disabled={busy}>
              <label htmlFor="lv-signup-name">Your name<input id="lv-signup-name" name="full_name" autoComplete="name" placeholder="Full name" minLength={2} maxLength={100} required/></label>
              <label htmlFor="lv-signup-business">Business name<input id="lv-signup-business" name="organization_name" autoComplete="organization" placeholder="Your organization" minLength={2} maxLength={100} required/></label>
              <label htmlFor="lv-signup-email">Work email<input id="lv-signup-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" maxLength={254} required/></label>
              <label htmlFor="lv-signup-password">Password</label>
              <div className="lv-signup-password">
                <input id="lv-signup-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Create a password" minLength={12} required aria-describedby="lv-signup-password-help" onChange={event => setPasswordLength(event.currentTarget.value.length)}/>
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="lv-signup-password" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}</button>
              </div>
              <p id="lv-signup-password-help" className="lv-signup-password-help" data-met={passwordLength >= 12}><Check size={13} aria-hidden="true"/> At least 12 characters. A longer passphrase works well.</p>
              {(error || notice) && <p className="lv-signup-error" role="alert">{error || notice}</p>}
              <button className="lv-signup-primary" type="submit">{busy ? externalBusy ? 'Please wait…' : 'Creating your account…' : 'Create business account'}{!busy && <ArrowRight size={16} aria-hidden="true"/>}</button>
            </fieldset>
          </form>
          <p className="lv-signup-security"><ShieldCheck size={14} aria-hidden="true"/> Confirm your email, then connect your first camera.</p>
          {onGoogle && <><div className="lv-signup-divider"><span>or</span></div><button className="lv-signup-google" type="button" disabled={busy} onClick={onGoogle}>Continue with Google</button></>}
          <p className="lv-signup-signin">Already have an account? <button type="button" disabled={busy} onClick={onSignIn}>Sign in</button></p>
        </>}
      </section>
    </div>
    <footer className="lv-signup-footer">LUNAR VISION <span>Business operations, connected.</span></footer>
  </main>;
}
