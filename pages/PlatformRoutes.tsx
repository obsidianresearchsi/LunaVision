import React from 'react';
import WorkspacePortal from './WorkspacePortal';
import BusinessLanding from './BusinessLanding';
import VideoAnalysis from '../components/VideoAnalysis';
import 'leaflet/dist/leaflet.css';
import '../styles/command-center.css';
import '../styles/operations.css';
import '../styles/surveillance-demo.css';
import '../styles/analyst-review.css';
import '../styles/reports.css';
import '../styles/lunar-vision.css';
import '../styles/mobile-workspace.css';

export default function PlatformRoutes() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  if (path === '/') return <BusinessLanding />;
  if (path === '/video-analysis') return <main className="lv-video-page"><VideoAnalysis samples /></main>;
  if (['/business', '/bussiness', '/agency', '/agency/admin'].includes(path)) {
    return <WorkspacePortal agency={!['/business', '/bussiness'].includes(path)} platformView={path === '/agency/admin'} />;
  }
  return <main className="lv-access"><section className="lv-card">
    <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="220" />
    <h1>Page unavailable</h1>
    <nav className="lv-portal-nav" aria-label="Public navigation"><a href="/">Back to Lunar Vision</a></nav>
  </section></main>;
}
