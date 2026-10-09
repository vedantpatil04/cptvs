import { useEffect, useState } from 'react';

import { serverNow } from '@/lib/server-clock';

/**
 * Server-corrected "now" in epoch milliseconds, re-rendering every second while `enabled`.
 * Elapsed time is always derived from this value and the session's entry instant, never from a
 * counter, so navigating away, refreshing or backgrounding the app cannot make it drift.
 * The interval is stopped while the page is hidden and the value is refreshed the moment the
 * page (or the Android WebView) comes back, and always cleaned up on unmount.
 */
export const useServerNow = (enabled = true): number => {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const tick = () => setNow(serverNow());
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      tick();
      timer = window.setInterval(tick, 1000);
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', tick);
    window.addEventListener('focus', tick);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', tick);
      window.removeEventListener('focus', tick);
    };
  }, [enabled]);

  return now;
};
