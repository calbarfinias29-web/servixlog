import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import { enableLocalMode } from './data/index.ts';
import './index.css';

if (new URLSearchParams(window.location.search).get('mode') === 'local') {
  enableLocalMode();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

