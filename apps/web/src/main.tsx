import '@fontsource-variable/noto-sans';
import '@fontsource-variable/noto-sans-devanagari';
import '@fontsource-variable/noto-sans-kannada';
import './styles/index.css';
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
