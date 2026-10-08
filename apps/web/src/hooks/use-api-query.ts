import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-client';

export type QueryState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: ApiError };

const toApiError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', String(error));

/**
 * Minimal data-fetching hook: runs `fetcher` on mount and whenever `refetch`
 * is called, cancelling in-flight requests on unmount or re-run.
 * `fetcher` must be stable (module-level function or memoised).
 */
export function useApiQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: toApiError(error) });
      });
    return () => controller.abort();
  }, [fetcher, version]);

  const refetch = useCallback(() => {
    setState({ status: 'loading' });
    setVersion((value) => value + 1);
  }, []);

  return { ...state, refetch };
}
