import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Filters and page number kept in the URL, so filtered views survive reloads
 * and can be bookmarked. Only the listed keys are read.
 */
export function useFilterParams(keys: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const serialized = params.toString();

  const filters = useMemo(() => {
    const current = new URLSearchParams(serialized);
    const values: Record<string, string> = {};
    for (const key of keys) {
      const value = current.get(key);
      if (value) values[key] = value;
    }
    return values;
    // `keys` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  const page = Math.max(Number(params.get('page')) || 1, 1);

  return {
    filters,
    page,
    setFilters: (values: Record<string, string>) => setParams(values),
    setPage: (next: number) =>
      setParams((current) => {
        const updated = new URLSearchParams(current);
        updated.set('page', String(next));
        return updated;
      }),
  };
}
