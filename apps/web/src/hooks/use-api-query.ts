import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';

export type QueryState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: ApiError };

const toApiError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', String(error));

interface QueryOptions {
  /** Reload in the background at this interval, keeping the current data visible. */
  refreshIntervalMs?: number;
}

/**
 * Minimal data-fetching hook: runs `fetcher` on mount and whenever it changes
 * or `refetch` is called, cancelling in-flight requests on unmount or re-run.
 * `fetcher` must be stable (module-level function or memoised with useCallback).
 */
export function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { refreshIntervalMs }: QueryOptions = {},
) {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const background = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const silent = background.current;
    background.current = false;
    fetcher(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        // A failed background refresh keeps showing the last good data.
        if (!controller.signal.aborted && !silent) {
          setState({ status: 'error', error: toApiError(error) });
        }
      });
    return () => controller.abort();
  }, [fetcher, version]);

  /** Shows the loading state and reloads. */
  const refetch = useCallback(() => {
    setState({ status: 'loading' });
    setVersion((value) => value + 1);
  }, []);

  /** Reloads in the background without hiding the current data. */
  const reload = useCallback(() => {
    background.current = true;
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!refreshIntervalMs) return;
    const timer = window.setInterval(reload, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [refreshIntervalMs, reload]);

  return { ...state, refetch, reload };
}
