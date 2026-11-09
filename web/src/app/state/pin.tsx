/**
 * PIN for sensitive actions (14.3, PR11, RF-WA-05): editing, removing, adding, redeeming and
 * changing data need the PIN typed in the last 10 minutes. Every 🔒 call goes through `withPin`:
 * if the server answers `pin_required`, a sheet asks for the PIN, verifies it and the action is
 * retried by itself. Lockouts follow 14.3 (5 wrong → 15 minutes; 10 → new activation link).
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { PIN_LENGTH, PinField } from '../components/pin-field';
import { Button, FieldError, Sheet } from '../components/ui';
import { ApiError, api, GENERIC_MESSAGE } from '../lib/api';
import { useSession } from './session';

/** She closed the PIN sheet: the action did not run. */
export class PinCancelled extends Error {
  constructor() {
    super('pin_cancelled');
    this.name = 'PinCancelled';
  }
}

export const isPinCancelled = (err: unknown) => err instanceof PinCancelled;

/** Terminal answers: typing again will not help (new link needed, or the session is gone). */
interface Blocked {
  code: string;
  message: string;
}

/** PIN verification state shared by the PIN sheet and the «entrar» screen. */
export function usePinVerify(onVerified: () => void) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = window.setTimeout(
      () => {
        setLockedUntil(null);
        setError(null);
      },
      Math.max(0, lockedUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [lockedUntil]);

  const verify = useCallback(async (value: string) => {
    if (value.length !== PIN_LENGTH) {
      setError('Tu PIN tiene 6 números.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/pin/verify', { pin: value });
      onVerifiedRef.current();
    } catch (err) {
      setPin('');
      if (!(err instanceof ApiError)) {
        setError(GENERIC_MESSAGE);
        return;
      }
      if (err.code === 'locked' && typeof err.body.lockedUntil === 'string') {
        setLockedUntil(Date.parse(err.body.lockedUntil));
      }
      if (err.code === 'activation_required' || err.status === 401) {
        setBlocked({ code: err.code, message: err.message });
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    pin,
    setPin,
    busy,
    error,
    locked: lockedUntil !== null,
    blocked,
    verify,
  };
}

/** What the PIN is asked for: the sheet says it (14.3 sensitive actions). */
export type PinReason = 'changes' | 'download' | 'redeem' | 'settings' | 'delete_account' | 'chat';

const PIN_REASON_TEXT: Record<PinReason, string> = {
  changes: 'Para hacer cambios',
  download: 'Para descargar tu historial',
  redeem: 'Para canjear tu premio',
  settings: 'Para cambiar tus datos',
  delete_account: 'Para borrar tu cuenta',
  chat: 'Para hacer el cambio que te propuse en el chat',
};

/** Runs a 🔒 action; if the server asks for the PIN, the sheet says why (`reason`). */
type WithPin = <T>(action: () => Promise<T>, reason?: PinReason) => Promise<T>;

const PinGateContext = createContext<WithPin | null>(null);

export function PinGateProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    reason: PinReason;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null>(null);

  const withPin = useCallback<WithPin>(async (action, reason = 'changes') => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'pin_required') throw err;
      await new Promise<void>((resolve, reject) => setRequest({ reason, resolve, reject }));
      return action();
    }
  }, []);

  return (
    <PinGateContext value={withPin}>
      {children}
      <PinSheet
        reason={request?.reason ?? 'changes'}
        open={request !== null}
        onVerified={() => {
          request?.resolve();
          setRequest(null);
        }}
        onCancel={() => {
          request?.reject(new PinCancelled());
          setRequest(null);
        }}
      />
    </PinGateContext>
  );
}

export function usePinGate(): WithPin {
  const value = useContext(PinGateContext);
  if (!value) throw new Error('usePinGate outside PinGateProvider');
  return value;
}

function PinSheet({
  reason,
  open,
  onVerified,
  onCancel,
}: {
  reason: PinReason;
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title="Escribe tu PIN">
      <PinSheetBody reason={reason} onVerified={onVerified} onCancel={onCancel} />
    </Sheet>
  );
}

function PinSheetBody({
  reason,
  onVerified,
  onCancel,
}: {
  reason: PinReason;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { signOut } = useSession();
  const errorId = useId();
  const state = usePinVerify(onVerified);

  if (state.blocked) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-base text-text">
          {state.blocked.message}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            onCancel();
            if (state.blocked?.code === 'unauthorized') signOut();
          }}
        >
          Entendido
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void state.verify(state.pin);
      }}
    >
      <p className="text-base text-muted">
        {PIN_REASON_TEXT[reason]}, confirma que eres tú. Después no te lo pediremos por 10 minutos.
      </p>
      <PinField
        id="pin-gate"
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
      <Button type="submit" loading={state.busy} disabled={state.locked}>
        Confirmar
      </Button>
      <p className="text-sm text-muted">
        ¿Olvidaste tu PIN? Escribe «olvidé mi PIN» en WhatsApp y te mando un enlace para crear uno
        nuevo.
      </p>
    </form>
  );
}
