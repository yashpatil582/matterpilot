import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Office.onReady fires once Office.js has initialized in the host. We mount
// React inside that callback so Office.context is safe to read from the
// first render. Outside of Office (e.g. opened directly in a browser for
// dev), we still mount — components that read Office.* should guard on
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
