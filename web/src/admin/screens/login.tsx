import { type FormEvent, useId, useState } from 'react';
import { AlzaLogo } from '../../components/AlzaLogo';
import { Btn } from '../components';
import { adminApi, errorText } from '../lib/api';
import type { AdminIdentity } from '../lib/types';
import { useAdminSession } from '../session';

export function LoginScreen() {
  const { signedIn, expired } = useAdminSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.post<{ admin: AdminIdentity }>('/auth/login', {
        username,
        password,
      });
      setPassword('');
      signedIn(res.admin);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'mt-1.5 block w-full rounded-lg border border-border bg-white px-3 py-2.5 text-base text-text outline-none focus:border-purple focus:ring-2 focus:ring-lav';

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <AlzaLogo />
          <span className="rounded-md bg-navy px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
            Panel
          </span>
        </div>
        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-card p-6"
          aria-describedby={error ? errorId : undefined}
        >
          <h1 className="text-xl font-bold text-navy">Panel interno</h1>
          <p className="mt-1 text-sm text-muted">
            Solo para el equipo. Cada acción queda registrada.
          </p>
          {expired && !error && (
            <p className="mt-4 rounded-lg bg-blue-soft px-3 py-2 text-sm text-navy">
              Tu sesión terminó. Vuelve a entrar.
            </p>
          )}
          <label className="mt-5 block text-sm font-semibold text-text">
            Usuario
            <input
              className={field}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold text-text">
            Contraseña
            <input
              className={field}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p id={errorId} role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
          <Btn type="submit" tone="primary" busy={busy} className="mt-5 w-full min-h-11">
            Entrar
          </Btn>
        </form>
      </div>
    </main>
  );
}
