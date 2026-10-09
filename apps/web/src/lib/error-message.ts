import type { ApiErrorCode } from '@cpvts/shared';
import type { TFunction } from 'i18next';

import { ApiError } from './api-client';

type ErrorTranslationKey = `errors.${ApiErrorCode}` | 'errors.network';

/** Translates any thrown value into a user-facing message in the active language. */
export const errorMessage = (t: TFunction, error: unknown): string => {
  if (error instanceof ApiError) {
    const key: ErrorTranslationKey =
      error.code === 'NETWORK_ERROR' ? 'errors.network' : `errors.${error.code}`;
    return t(key);
  }
  return t('states.errorDescription');
};
