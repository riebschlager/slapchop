import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { initNative } from './lib/native';
import './index.css';

initNative().catch((e) => console.error('Native init failed:', e));

// Registers window.__runIpcProbe for the Phase 2 transport measurement. The
// dynamic import inside this guard is dropped from production builds.
if (import.meta.env.DEV) void import('./lib/ipcProbe');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
