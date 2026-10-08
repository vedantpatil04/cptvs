import { useCallback, useState } from 'react';

/** Width fallback where layout is unavailable (tests, very old WebViews). */
const FALLBACK_WIDTH = 640;

/** Tracks an element's rendered width with a ResizeObserver (callback ref). */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);

  const ref = useCallback((element: T | null) => {
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') {
      setWidth(element.clientWidth || FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(element.clientWidth || FALLBACK_WIDTH);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
