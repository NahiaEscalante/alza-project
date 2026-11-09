/**
 * Access (14.3, HU-09, HU-10, 12.2 «Activación y PIN»):
 * - `/app/activar/:token`: 1-hour activation link → «Crea tu PIN» (twice) → Inicio.
 * - `/app/entrar/:token`: 7-day link → remembered phone goes straight in; otherwise the PIN.
 * - No session: tells her to open her link or write «web» in the ALZA chat (D73).
 * The token leaves the address bar as soon as the server keeps it in its cookie.
 */
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useLocation } from 'wouter';
import { AlzaLogo } from '../../components/AlzaLogo';
import { ClockIcon, LinkIcon, LockIcon } from '../components/icons';
import { PIN_LENGTH, PinField } from '../components/pin-field';
import { Button, ErrorState, FieldError, Spinner } from '../components/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { usePinVerify } from '../state/pin';
import { type SignOutNotice, useSession } from '../state/session';
import { useToast } from '../state/toast';

const NO_SESSION_MESSAGE =
  'Para entrar, abre el enlace de tu último cierre o escribe «web» en el chat de ALZA para recibir uno.';

function AuthLayout({ children, title }: { children: ReactNode; title: string }) {
  useEffect(() => {
    document.title = `${title} · ALZA`;
  }, [title]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-110 flex-col px-4 pb-10">
      <header className="flex min-h-15 items-center px-1 pt-1.5">
        <AlzaLogo />
      </header>
      <main className="flex flex-1 flex-col pt-4">{children}</main>
    </div>
  );
}

function Checking({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 text-muted"
    >
      <Spinner className="size-8 text-purple" />
      <p className="text-base">{text}</p>
    </div>
  );
}

/** A dead end with what to do next (expired link, blocked PIN, no session). */
function MessageScreen({
  icon,
  title,
  message,
  hint = hintFor(message),
  children,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  /** What to write in the ALZA chat; by default the word the message asks for. */
  hint?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 pt-8 text-center">
      <span className="mb-1 grid size-16 place-items-center rounded-full bg-lav-soft text-purple">
        {icon}
      </span>
      <h1 className="text-2xl leading-tight font-bold text-text">{title}</h1>
      <p className="text-base text-muted">{message}</p>
      {hint && <ChatHint word={hint} />}
      {children}
    </div>
  );
}

/** «olvidé mi PIN» when the message asks for a new PIN; otherwise «web». */
function hintFor(message: string): string {
  return message.includes('olvidé mi PIN') ? 'olvidé mi PIN' : 'web';
}

/** What to type in the ALZA chat (WhatsApp, or Telegram in the demo: D73), as a bubble. */
function ChatHint({ word }: { word: string }) {
  return (
    <div className="mt-3 w-full rounded-[18px] border border-border bg-card p-4 text-left">
      <p className="text-sm font-semibold text-muted">En el chat de ALZA, escribe:</p>
      <p className="mt-2 ml-auto w-fit rounded-2xl rounded-br-sm bg-[#dcf8c6] px-4 py-2 text-lg font-semibold text-text">
        {word}
      </p>
    </div>
  );
}

export function NoSessionScreen({ notice }: { notice: SignOutNotice | null }) {
  const title = notice?.title ?? 'Entra con tu enlace';
  return (
    <AuthLayout title={title}>
      <MessageScreen
        icon={<LinkIcon className="size-8" />}
        title={title}
        message={notice?.message ?? NO_SESSION_MESSAGE}
        hint={notice ? notice.hint : 'web'}
      />
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Activation: «Crea tu PIN»
// ---------------------------------------------------------------------------

type ActivatePhase =
  | { kind: 'checking' }
  | { kind: 'form'; hasPin: boolean }
  | { kind: 'dead'; message: string }
  | { kind: 'error'; message: string };

export function ActivateScreen({ token }: { token?: string }) {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<ActivatePhase>(
    token ? { kind: 'checking' } : { kind: 'form', hasPin: false },
  );
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` retries after a network error
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.post<{ hasPin: boolean }>('/auth/activate', { token }).then(
      (result) => {
        if (!alive) return;
        setPhase({ kind: 'form', hasPin: result.hasPin });
        navigate('/activar', { replace: true });
      },
      (err) => {
        if (!alive) return;
        setPhase(
          err instanceof ApiError && err.status === 410
            ? { kind: 'dead', message: err.message }
            : { kind: 'error', message: errorMessage(err) },
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  return (
    <AuthLayout title="Crea tu PIN">
      {phase.kind === 'checking' && <Checking text="Revisando tu enlace…" />}
      {phase.kind === 'dead' && (
        <MessageScreen
          icon={<ClockIcon className="size-8" />}
          title="Este enlace ya no sirve"
          message={phase.message}
        />
      )}
      {phase.kind === 'error' && (
        <ErrorState message={phase.message} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {phase.kind === 'form' && (
        <CreatePinForm
          hasPin={phase.hasPin}
          onDead={(message) => setPhase({ kind: 'dead', message })}
        />
      )}
    </AuthLayout>
  );
}

function CreatePinForm({ hasPin, onDead }: { hasPin: boolean; onDead: (message: string) => void }) {
  const [, navigate] = useLocation();
  const { signIn } = useSession();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<{ field: 'pin' | 'confirmation'; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  async function save() {
    if (pin.length !== PIN_LENGTH) {
      setError({ field: 'pin', message: 'Tu PIN tiene 6 números.' });
      return;
    }
    if (confirmation.length !== PIN_LENGTH) {
      setError({ field: 'confirmation', message: 'Escribe tu PIN otra vez para confirmarlo.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/pin', { pin, pinConfirmation: confirmation });
      signIn();
      toast('¡Listo! Guardamos tu PIN.');
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 401)) {
        onDead(err.message);
        return;
      }
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'mismatch') {
        setConfirmation('');
        setError({ field: 'confirmation', message: errorMessage(err) });
      } else {
        setPin('');
        setConfirmation('');
        setError({ field: 'pin', message: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <h1 className="text-2xl leading-tight font-bold text-text">
          {hasPin ? 'Crea tu nuevo PIN' : 'Crea tu PIN'}
        </h1>
        <p className="mt-2 text-base text-muted">
          Lo usarás para cambiar datos, descargar y canjear premios.
        </p>
      </div>
      <div className="rounded-[18px] border border-border bg-card p-4">
        <PinField
          id="new-pin"
          label="Tu PIN de 6 números"
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error?.field === 'pin') setError(null);
          }}
          autoFocus
          disabled={busy}
          invalid={error?.field === 'pin'}
          describedBy={error?.field === 'pin' ? errorId : undefined}
        />
        {error?.field === 'pin' && <FieldError id={errorId}>{error.message}</FieldError>}
        <div className="mt-5">
          <PinField
            id="new-pin-confirmation"
            label="Escríbelo otra vez"
            value={confirmation}
            onChange={(value) => {
              setConfirmation(value);
              if (error?.field === 'confirmation') setError(null);
            }}
            disabled={busy}
            invalid={error?.field === 'confirmation'}
            describedBy={error?.field === 'confirmation' ? errorId : undefined}
          />
          {error?.field === 'confirmation' && <FieldError id={errorId}>{error.message}</FieldError>}
        </div>
        <p className="mt-4 text-sm text-muted">
          Evita números seguidos (123456), repetidos (111111) o los últimos 6 de tu celular.
        </p>
      </div>
      <Button type="submit" loading={busy}>
        Guardar mi PIN
      </Button>
      <p className="flex items-start gap-2 text-sm text-muted">
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        Nadie de ALZA puede ver tu PIN. Este celular quedará recordado por 30 días.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 7-day link: «Entrar»
// ---------------------------------------------------------------------------

type EnterPhase =
  | { kind: 'checking' }
  | { kind: 'pin' }
  | { kind: 'dead'; title: string; message: string }
  | { kind: 'error'; message: string };

interface EnterResponse {
  status: 'ok' | 'pin_required' | 'activation_required';
  message?: string;
}

export function EnterScreen({ token }: { token?: string }) {
  const [, navigate] = useLocation();
  const { signIn } = useSession();
  const [phase, setPhase] = useState<EnterPhase>(token ? { kind: 'checking' } : { kind: 'pin' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` retries after a network error
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.post<EnterResponse>('/auth/enter', { token }).then(
      (result) => {
        if (!alive) return;
        if (result.status === 'ok') {
          signIn();
          navigate('/', { replace: true });
        } else if (result.status === 'pin_required') {
          setPhase({ kind: 'pin' });
          navigate('/entrar', { replace: true });
        } else {
          setPhase({
            kind: 'dead',
            title: 'Necesitas un PIN nuevo',
            message: result.message ?? NO_SESSION_MESSAGE,
          });
        }
      },
      (err) => {
        if (!alive) return;
        setPhase(
          err instanceof ApiError && err.status === 410
            ? { kind: 'dead', title: 'Este enlace ya no sirve', message: err.message }
            : { kind: 'error', message: errorMessage(err) },
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  return (
    <AuthLayout title="Entrar">
      {phase.kind === 'checking' && <Checking text="Abriendo tu cuenta…" />}
      {phase.kind === 'dead' && (
        <MessageScreen
          icon={<ClockIcon className="size-8" />}
          title={phase.title}
          message={phase.message}
        />
      )}
      {phase.kind === 'error' && (
        <ErrorState message={phase.message} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {phase.kind === 'pin' && <LoginPinForm />}
    </AuthLayout>
  );
}

function LoginPinForm() {
  const [, navigate] = useLocation();
  const { signIn } = useSession();
  const errorId = useId();
  const state = usePinVerify(() => {
    signIn();
    navigate('/', { replace: true });
  });

  if (state.blocked) {
    return (
      <MessageScreen
        icon={<LockIcon className="size-8" />}
        title="No pudimos entrar"
        message={state.blocked.message}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void state.verify(state.pin);
      }}
    >
      <div>
        <h1 className="text-2xl leading-tight font-bold text-text">Escribe tu PIN</h1>
        <p className="mt-2 text-base text-muted">
          Es la primera vez que entras desde este celular. Después lo recordaremos por 30 días.
        </p>
      </div>
      <div className="rounded-[18px] border border-border bg-card p-4">
        <PinField
          id="login-pin"
          label="Tu PIN de 6 números"
          value={state.pin}
          onChange={state.setPin}
          onComplete={(value) => void state.verify(value)}
          autoFocus
          disabled={state.busy || state.locked}
          invalid={state.error !== null}
          describedBy={state.error ? errorId : undefined}
        />
        <FieldError id={errorId}>{state.error}</FieldError>
      </div>
      <Button type="submit" loading={state.busy} disabled={state.locked}>
        Entrar
      </Button>
      <p className="text-sm text-muted">
        ¿Olvidaste tu PIN? Escribe «olvidé mi PIN» en el chat donde mandas tus capturas y te mando
        un enlace para crear uno nuevo.
      </p>
    </form>
  );
}
