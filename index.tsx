import React from 'react';
import ReactDOM from 'react-dom/client';
import WorkspacePortal from './pages/WorkspacePortal';
import BusinessLanding from './pages/BusinessLanding';
import VideoAnalysis from './components/VideoAnalysis';
import 'leaflet/dist/leaflet.css';
import './styles/command-center.css';
import './styles/operations.css';
import './styles/surveillance-demo.css';
import './styles/analyst-review.css';
import './styles/reports.css';
import './styles/lunar-vision.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const path = location.pathname.replace(/\/$/, '') || '/';

root.render(
  <React.StrictMode>
    {path === '/' ? <BusinessLanding /> : path === '/video-analysis' ? (
      <main className="lv-video-page"><VideoAnalysis samples /></main>
    ) : ['/business', '/agency', '/agency/admin'].includes(path) ? (
      <WorkspacePortal agency={path !== '/business'} platformView={path === '/agency/admin'} />
    ) : (
      <main className="lv-access">
        <section className="lv-card">
          <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="220" />
          <h1>Page unavailable</h1>
          <nav className="lv-portal-nav" aria-label="Public navigation">
            <a href="/">Back to Lunar Vision</a>
          </nav>
        </section>
      </main>
    )}
  </React.StrictMode>
);
