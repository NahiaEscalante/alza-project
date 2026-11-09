/**
 * `fetch` for the web API (`/api`, 10.4). JSON in and out; the session is an HttpOnly cookie the
 * browser sends by itself. Errors come back as `{ error, message }` with the message in Spanish;
 * `ApiError` keeps the whole body (e.g. `attemptsLeft`, `lockedUntil`).
 */

export const NETWORK_MESSAGE = 'No pudimos conectarnos. Revisa tu internet e intenta de nuevo.';
export const GENERIC_MESSAGE = 'Algo salió mal. Intenta de nuevo en un momento.';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    const message = typeof body.message === 'string' ? body.message : GENERIC_MESSAGE;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof body.error === 'string' ? body.error : status === 0 ? 'network' : 'unknown';
    this.body = body;
  }
}

/** Called on every 401: the session is gone (expired, «salir de todos», deleted account). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'network', message: NETWORK_MESSAGE });
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new ApiError(
      res.status,
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    );
    // Auth routes answer 401 as part of their flow; everywhere else it means «no session».
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : GENERIC_MESSAGE;
}
