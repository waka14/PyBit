import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  if (import.meta.env.DEV) { const registrations = await navigator.serviceWorker.getRegistrations(); const ownScript = new URL('/sw.js', location.origin).href; await Promise.all(registrations.filter((registration) => registration.active?.scriptURL === ownScript).map((registration) => registration.unregister())); return; }
  const registration = await navigator.serviceWorker.register('/sw.js').catch(() => undefined); if (!registration) return;
  const announce = () => window.dispatchEvent(new Event('pybit-update-ready'));
  registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => { if (registration.waiting) announce(); }));
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
});
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
