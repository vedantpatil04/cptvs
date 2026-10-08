import type { TFunction } from 'i18next';

import { ApiError } from './api-client';

/** Translates any thrown value into a user-facing message in the active language. */
export const errorMessage = (t: TFunction, error: unknown): string => {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK_ERROR' ? t('errors.network') : t(`errors.${error.code}`);
  }
  return t('states.errorDescription');
};
