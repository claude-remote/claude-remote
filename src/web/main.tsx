import { createRoot } from 'react-dom/client';

import { App } from '@/web/App';

// TODO(T11): mount the app with final global providers, theme tokens, and SW bootstrapping.
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root container');
}

createRoot(rootElement).render(<App />);
