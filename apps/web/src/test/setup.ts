import '@testing-library/jest-dom/vitest';
import '@/i18n';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are disabled, so Testing Library cannot register this itself.
afterEach(cleanup);

// jsdom does not implement scrolling.
Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
