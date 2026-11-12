import React, { useEffect, useState } from 'react';
import '../styles/platform-update.css';

const START_KEY = 'lv:platform-update:2026-11:v1';
const DURATION = 5 * 60 * 1000;
// Presentation-only progress. No download or migration is started by this page.
const STAGES = [[0, 0], [0.08, 7], [0.23, 24], [0.42, 43], [0.62, 68], [0.8, 86], [0.94, 96], [1, 99]];

function progressAt(startedAt: number): number {
  const fraction = Math.max(0, Math.min(1, (Date.now() - startedAt) / DURATION));
  const next = STAGES.findIndex(([time]) => time >= fraction);
  if (next <= 0) return 0;
  const [time, value] = STAGES[next];
  const [previousTime, previousValue] = STAGES[next - 1];
  return Math.min(99, Math.floor(previousValue + (value - previousValue) * (fraction - previousTime) / (time - previousTime)));
}

function readStart(): number {
  const now = Date.now();
  try {
    const saved = Number(localStorage.getItem(START_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= now) return saved;
    localStorage.setItem(START_KEY, String(now));
  } catch { /* Private browsing can disallow storage; the current visit still works. */ }
  return now;
}

export default function PlatformUpdate() {
  const [startedAt] = useState(readStart);
  const [progress, setProgress] = useState(() => progressAt(startedAt));
  useEffect(() => {
    document.title = 'Platform Update | Lunar Vision';
    if (progress >= 99) return;
    const timer = setInterval(() => {
      const value = progressAt(startedAt);
      setProgress(value);
      if (value >= 99) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const phase = progress < 15 ? 'Preparing the platform' : progress < 70 ? 'Applying platform updates' : progress < 99 ? 'Preparing your workspace' : 'Finalizing the update';
  return <main className="lv-update">
    <header className="lv-update-brand"><img src="/logo/lunar-vision-white.png" alt="Lunar Vision" /><span>PLATFORM SERVICES</span></header>
    <section className="lv-update-content" aria-labelledby="update-heading">
      <div className="lv-update-orbit" aria-hidden="true"><span /><span /><img src="/logo/lunar-orbit.png" alt="" /></div>
      <p className="lv-update-eyebrow"><i /> SYSTEM MAINTENANCE</p>
      <h1 id="update-heading">A new horizon.<br /><span>Coming into view.</span></h1>
      <p className="lv-update-description">We’re updating Lunar Vision.<br />Your workspace will be available when maintenance is complete.</p>
      <div className="lv-update-progress">
        <div className="lv-update-progress-label"><span>Platform update</span><strong>{progress}<small>%</small></strong></div>
        <div className="lv-update-track" role="progressbar" aria-label="Platform update progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% — ${phase}`}><span style={{ width: `${progress}%` }} /></div>
        <p className="lv-update-phase" role="status"><span className="lv-update-spinner" aria-hidden="true" />{phase}<span className="lv-update-dots" aria-hidden="true">…</span></p>
      </div>
      <p className="lv-update-note">Thank you for your patience.</p>
    </section>
    <footer className="lv-update-footer"><span>LUNAR VISION</span><span>INTELLIGENCE IN EVERY FRAME</span><span>BY LUNAR ROBOTICS</span></footer>
  </main>;
}
