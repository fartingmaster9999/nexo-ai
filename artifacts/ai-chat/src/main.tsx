import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import './nexo.css';
import './refine.css';
import './landing.css';
import './ux-polish.css';
import './answer-format.css';
import './motion.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const appBase = new URL(import.meta.env.BASE_URL, window.location.href);
    const workerUrl = new URL('service-worker.js', appBase);
    void navigator.serviceWorker.register(workerUrl, { scope: appBase.pathname }).catch((error: unknown) => {
      console.warn('Nexo offline support could not be initialized.', error);
    });
  }, { once: true });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
