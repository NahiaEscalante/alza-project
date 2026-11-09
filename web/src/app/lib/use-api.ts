import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

interface ApiState<T> {
  path: string | null;
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

/**
 * GET with loading and error states. Data belongs to its path: when the path changes the old data
 * is dropped, so a screen never shows last week's numbers under this week's title.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<ApiState<T>>({
    path,
    data: undefined,
    error: null,
    loading: path !== null,
  });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` re-runs the request on reload
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    setState((current) => ({
      path,
      data: current.path === path ? current.data : undefined,
      error: null,
      loading: true,
    }));
    api.get<T>(path).then(
      (data) => {
        if (alive) setState({ path, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (alive) setState((current) => ({ ...current, path, error, loading: false }));
      },
    );
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (update: (current: T | undefined) => T | undefined) =>
      setState((current) => ({ ...current, data: update(current.data) })),
    [],
  );
  const fresh = state.path === path;
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : null,
    loading: !fresh || state.loading,
    reload,
    setData,
  };
}
