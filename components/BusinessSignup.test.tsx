import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const {signUp} = vi.hoisted(() => ({signUp: vi.fn()}));
vi.mock('../services/supabase', () => ({supabase: {auth: {signUp}}}));
import BusinessSignup from './BusinessSignup';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  signUp.mockResolvedValue({data: {session: null}, error: null});
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
async function render(onSignIn = vi.fn()) {await act(async () => root.render(<BusinessSignup onSignIn={onSignIn}/>)); return onSignIn;}
async function submit() {
  for (const [name, value] of Object.entries({full_name: ' Ada Okafor ', organization_name: ' Meridian Logistics ', email: 'ada@example.com', password: 'a-long-passphrase'})) {
    (host.querySelector(`[name=${name}]`) as HTMLInputElement).value = value;
  }
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
}
describe('Business signup', () => {
  it('saves the business profile in Supabase Auth without granting client-defined permissions', async () => {
    await render(); await submit();
    expect(signUp).toHaveBeenCalledWith({email:'ada@example.com',password:'a-long-passphrase',options:{emailRedirectTo:location.origin+'/business',data:{full_name:'Ada Okafor',organization_name:'Meridian Logistics',business_signup_version:1}}});
    expect(host.textContent).toContain('Check your email'); expect(host.textContent).toContain('ada@example.com');
    expect(host.querySelector('input[type=password]')).toBeNull();
  });
  it('keeps entered details on a signup error so the customer can retry', async () => {
    signUp.mockResolvedValue({data: {}, error:{message:'Please wait before trying again.'}});
    await render(); await submit();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Please wait');
    expect((host.querySelector('[name=organization_name]') as HTMLInputElement).value).toContain('Meridian Logistics');
    expect(host.querySelector('fieldset')?.disabled).toBe(false);
  });
  it('rejects whitespace-only profile fields before calling Supabase', async () => {
    await render(); (host.querySelector('[name=full_name]') as HTMLInputElement).value='   ';
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(signUp).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).not.toBeNull();
  });
  it('lets users reveal their password and return to sign in', async () => {
    const onSignIn=await render();
    await act(async () => (host.querySelector('[aria-label="Show password"]') as HTMLButtonElement).click());
    expect(host.querySelector('[name=password]')?.getAttribute('type')).toBe('text');
    expect(host.querySelector('[aria-label="Hide password"]')?.getAttribute('aria-pressed')).toBe('true');
    const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Sign in')!;
    await act(async()=>button.click()); expect(onSignIn).toHaveBeenCalledOnce();
  });
});
