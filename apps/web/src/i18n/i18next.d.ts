import 'i18next';

import type { TranslationCatalogue } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: TranslationCatalogue };
  }
}
