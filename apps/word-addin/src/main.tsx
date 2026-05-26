import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Office.onReady fires once Office.js has loaded into the host. We mount
// React inside that callback so Word.* APIs are safe to call from the
// first render. Outside of Word (e.g. opened directly in a browser for
// dev), we still mount — components that touch Word.* should guard on
// the host being available.
Office.onReady().then(() => {
  const root = document.getElementById('root');
  if (!root) throw new Error('Mount node #root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
