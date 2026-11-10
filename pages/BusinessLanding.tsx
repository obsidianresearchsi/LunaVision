import React from 'react';
import { ArrowDown, ArrowRight, Building2, Camera, ClipboardList, ScanLine } from 'lucide-react';
import '../styles/business-landing.css';

const capabilities = [
  { icon: Camera, title: 'Camera management', detail: 'Register supported cameras, organize them by location and open their feeds from your workspace.' },
  { icon: ScanLine, title: 'Video analysis', detail: 'Review footage and detect people, vehicles and other objects in supported video sources.' },
  { icon: ClipboardList, title: 'Site and incident records', detail: 'Keep a shared record of what happened, update its status and give the next shift a clear handover.' },
];

const sectors = ['Ports and logistics', 'Manufacturing and industrial sites', 'Commercial property', 'Corporate campuses'];

export default function BusinessLanding() {
  return (
    <div className="lv-business-home">
      <a className="lv-bh-skip" href="#main">Skip to content</a>
      <header className="lv-bh-header">
        <div className="lv-bh-wrap lv-bh-nav">
          <a href="/" className="lv-bh-brand" aria-label="Lunar Vision home">
            <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="168" />
          </a>
          <nav aria-label="Main navigation">
            <a href="#platform">Platform</a>
            <a href="#industries">Industries</a>
          </nav>
          <a className="lv-bh-signin" href="/business">Sign in <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <main id="main">
        <section className="lv-bh-hero" aria-labelledby="business-title">
          <img className="lv-bh-hero-image" src="/lunar/berth-02.webp" alt="" fetchPriority="high" />
          <div className="lv-bh-wrap lv-bh-hero-inner">
            <div className="lv-bh-hero-copy">
              <p className="lv-bh-kicker"><span /> Enterprise site operations</p>
              <h1 id="business-title">See what’s happening across your sites.</h1>
              <p className="lv-bh-intro">Bring cameras, footage review and incident records into one workspace for your operations team.</p>
              <a className="lv-bh-button" href="/business?mode=register">Create a workspace <ArrowRight size={18} aria-hidden="true" /></a>
            </div>
            <div className="lv-bh-hero-index">
              <a href="#platform" aria-label="Explore the platform"><ArrowDown size={15} aria-hidden="true" /> Explore the platform</a>
              <span>01 / Commercial operations</span>
            </div>
          </div>
        </section>

        <section id="platform" className="lv-bh-platform">
          <div className="lv-bh-wrap">
            <div className="lv-bh-section-head">
              <p className="lv-bh-kicker"><span /> 01 / Platform</p>
              <h2>From the camera feed to the incident record.</h2>
            </div>
            <div className="lv-bh-capabilities">
              {capabilities.map(({ icon: Icon, title, detail }, index) => (
                <article key={title}>
                  <div className="lv-bh-card-index"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /><span>0{index + 1}</span></div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="industries" className="lv-bh-industries">
          <div className="lv-bh-wrap lv-bh-industry-grid">
            <div>
              <p className="lv-bh-kicker"><span /> 02 / Industries</p>
              <h2>Built for teams that run physical sites.</h2>
              <p>Give each team a shared view of its cameras and incident records, from the gate to the operations office.</p>
            </div>
            <ul>{sectors.map(sector => <li key={sector}><Building2 size={18} strokeWidth={1.5} aria-hidden="true" />{sector}</li>)}</ul>
          </div>
        </section>

        <section className="lv-bh-cta">
          <div className="lv-bh-wrap">
            <div><p className="lv-bh-kicker"><span /> Get started</p><h2>Set up your first site.</h2></div>
            <a className="lv-bh-button" href="/business?mode=register">Create a workspace <ArrowRight size={18} aria-hidden="true" /></a>
          </div>
        </section>
      </main>
      <footer className="lv-bh-footer">
        <div className="lv-bh-wrap">
          <a href="/" className="lv-bh-brand" aria-label="Lunar Vision home"><img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="140" /></a>
          <p>Enterprise site operations</p>
          <a href="/business">Business sign in <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
      </footer>
    </div>
  );
}
