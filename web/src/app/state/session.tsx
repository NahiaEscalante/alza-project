/**
 * Her session in this browser (14.3): a remembered phone has an HttpOnly cookie the page cannot
 * read, so the state comes from `GET /api/auth/session`. Any 401 later (30 days passed, «salir de
 * todos», account deleted) sends her to the «abre tu enlace» screen.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api, setUnauthorizedHandler } from '../lib/api';
import type { SessionResponse, SettingsView } from '../lib/types';

type Status = 'unknown' | 'checking' | 'in' | 'out' | 'error';

/** What the «sin sesión» screen says when leaving was news to her. */
export interface SignOutNotice {
  title: string;
  message: string;
  /** Word to write in WhatsApp to come back; null when there is no coming back (deleted). */
  hint: string | null;
}

export interface Profile {
  firstName: string | null;
  businessName: string | null;
}

interface SessionValue {
  status: Status;
  /** Why she is out, when it is news to her («Listo, cerraste tu sesión…»). */
  notice: SignOutNotice | null;
  profile: Profile | null;
  check: () => void;
  signIn: () => void;
  signOut: (notice?: SignOutNotice | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('unknown');
  const [notice, setNotice] = useState<SignOutNotice | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const signOut = useCallback((next: SignOutNotice | null = null) => {
    setStatus('out');
    setNotice(next);
    setProfile(null);
  }, []);

  const signIn = useCallback(() => {
    setNotice(null);
    setStatus('in');
  }, []);

  const check = useCallback(() => {
    setStatus('checking');
    api.get<SessionResponse>('/auth/session').then(
      (session) => setStatus(session.authenticated ? 'in' : 'out'),
      (err) => setStatus(err instanceof ApiError && err.status === 401 ? 'out' : 'error'),
    );
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Greeting for the header («Hola, Marta · Bodega Sol»).
  useEffect(() => {
    if (status !== 'in' || profile) return;
    let alive = true;
    api.get<SettingsView>('/settings').then(
      (settings) => {
        if (!alive) return;
        setProfile({
          firstName: settings.accountHolderName?.trim().split(/\s+/)[0] ?? null,
          businessName: settings.businessName,
        });
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [status, profile]);

  const value = useMemo(
    () => ({ status, notice, profile, check, signIn, signOut }),
    [status, notice, profile, check, signIn, signOut],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
