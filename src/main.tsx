import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import { enableLocalMode } from './data/index.ts';
import './index.css';
import DescarcarePage from './pages/DescarcarePage.tsx';

if (new URLSearchParams(window.location.search).get('mode') === 'local') {
  enableLocalMode();
}

// Ruta publică /descarcare — nu necesită autentificare și nu încarcă aplicația principală.
if (window.location.pathname.replace(/\/+$/, '') === '/descarcare' || window.location.pathname === '/descarcare/') {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DescarcarePage />
    </StrictMode>
  );
} else {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
}

