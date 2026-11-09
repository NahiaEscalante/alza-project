/** The panel session: who is signed in, checked once on load and dropped on any 401. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { adminApi, setAdminUnauthorizedHandler } from './lib/api';
import type { AdminIdentity, SessionResponse } from './lib/types';

type Status = 'checking' | 'in' | 'out' | 'error';

interface AdminSession {
  status: Status;
  admin: AdminIdentity | null;
  /** Set when the session ended by itself (expired, logged out elsewhere). */
  expired: boolean;
  check: () => void;
  signedIn: (admin: AdminIdentity) => void;
  logout: () => Promise<void>;
}

const Context = createContext<AdminSession | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [expired, setExpired] = useState(false);

  const check = useCallback(() => {
    setStatus('checking');
    adminApi.get<SessionResponse>('/auth/session').then(
      (res) => {
        setAdmin(res.admin ?? null);
        setStatus(res.authenticated ? 'in' : 'out');
      },
      () => setStatus('error'),
    );
  }, []);

  useEffect(() => {
    check();
    setAdminUnauthorizedHandler(() => {
      setAdmin(null);
      setExpired(true);
      setStatus('out');
    });
    return () => setAdminUnauthorizedHandler(null);
  }, [check]);

  const signedIn = useCallback((next: AdminIdentity) => {
    setAdmin(next);
    setExpired(false);
    setStatus('in');
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.post('/auth/logout');
    } finally {
      setAdmin(null);
      setExpired(false);
      setStatus('out');
    }
  }, []);

  return (
    <Context.Provider value={{ status, admin, expired, check, signedIn, logout }}>
      {children}
    </Context.Provider>
  );
}

export function useAdminSession(): AdminSession {
  const value = useContext(Context);
  if (!value) throw new Error('useAdminSession outside AdminSessionProvider');
  return value;
}
