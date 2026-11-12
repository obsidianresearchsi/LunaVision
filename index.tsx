import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import PlatformUpdate from './components/PlatformUpdate';

// Keep portal code and its data connections unmounted during maintenance.
const PlatformRoutes = lazy(() => import('./pages/PlatformRoutes'));
const updateEnabled = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_PLATFORM_UPDATE_ENABLED !== 'false';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {updateEnabled ? <PlatformUpdate /> : <Suspense fallback={null}><PlatformRoutes /></Suspense>}
  </React.StrictMode>
);
