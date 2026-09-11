import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import { enableLocalMode } from './data/index.ts';
import { AngajatDeviceGate } from './angajat/AngajatDeviceGate';
import './index.css';
import DescarcarePage from './pages/DescarcarePage.tsx';

const urlMode = new URLSearchParams(window.location.search).get('mode');
// Admin / Main PC — Local Mode opt-in existent (comportament neschimbat).
if (urlMode === 'local') {
  enableLocalMode();
}
// Angajat Local Client — entry dedicat: gate-ul de dispozitiv activează
// Local Mode DOAR după pairing, pe serverul din QR/cod (serverAddress).
const angajatClient = urlMode === 'angajat';

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
      {angajatClient ? <AngajatDeviceGate><App /></AngajatDeviceGate> : <App />}
    </ErrorBoundary>
  </StrictMode>
);
}

