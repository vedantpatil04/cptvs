import type { TrackingResponse } from '@cpvts/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { parkingApi } from './parking-api';

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; result: TrackingResponse }
  | { status: 'error'; error: unknown };

/** Fetches a tracking result into `setState`, ignoring responses for aborted searches. */
const trackInto = (
  query: string,
  signal: AbortSignal,
  setState: (state: SearchState) => void,
): Promise<void> =>
  parkingApi
    .track(query, signal)
    .then((result) => {
      if (!signal.aborted) setState({ status: 'found', result });
    })
    .catch((error: unknown) => {
      if (!signal.aborted) setState({ status: 'error', error });
    });

/** Runs a tracking search; the server decides how to interpret the text. */
export function useVehicleSearch(initialQuery?: string | null) {
  const [state, setState] = useState<SearchState>(() =>
    initialQuery ? { status: 'searching' } : { status: 'idle' },
  );
  const controller = useRef<AbortController | null>(null);

  const search = useCallback((query: string) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: 'searching' });
    return trackInto(query, current.signal, setState);
  }, []);

  // Search once for a query present when the page opens (e.g. a deep link).
  useEffect(() => {
    if (!initialQuery) return;
    const current = new AbortController();
    controller.current = current;
    void trackInto(initialQuery, current.signal, setState);
    return () => current.abort();
  }, [initialQuery]);

  const clear = useCallback(() => setState({ status: 'idle' }), []);
  return { state, search, clear };
}
