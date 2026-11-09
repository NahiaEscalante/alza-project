/**
 * `fetch` for the panel API (`/api/admin`). JSON in and out; the session is the HttpOnly
 * `alza_admin` cookie. Separate from the user's web client: a 401 here only logs the panel out.
 */
import { useCallback, useEffect, useState } from 'react';

export const NETWORK_MESSAGE = 'No pudimos conectarnos con el servidor.';
export const GENERIC_MESSAGE = 'Algo salió mal. Intenta de nuevo.';

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.message === 'string' ? body.message : GENERIC_MESSAGE);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = typeof body.error === 'string' ? body.error : status === 0 ? 'network' : 'unknown';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setAdminUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new AdminApiError(0, { error: 'network', message: NETWORK_MESSAGE });
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new AdminApiError(
      res.status,
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    );
  }
  return data as T;
}

export const adminApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
};

export function errorText(err: unknown): string {
  return err instanceof AdminApiError ? err.message : GENERIC_MESSAGE;
}

/** GET with loading and error states; `reload()` fetches again. Data belongs to its path. */
export function useAdminApi<T>(path: string) {
  const [state, setState] = useState<{
    path: string;
    data?: T;
    error: unknown;
    loading: boolean;
  }>({ path, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` re-runs the request on reload
  useEffect(() => {
    let alive = true;
    setState((current) => ({
      path,
      data: current.path === path ? current.data : undefined,
      error: null,
      loading: true,
    }));
    adminApi.get<T>(path).then(
      (data) => alive && setState({ path, data, error: null, loading: false }),
      (error: unknown) =>
        alive && setState((current) => ({ ...current, path, error, loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const fresh = state.path === path;
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : null,
    loading: !fresh || state.loading,
    reload,
  };
}
