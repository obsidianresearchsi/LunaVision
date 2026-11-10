import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
