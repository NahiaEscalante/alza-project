/**
 * Building blocks of the user's web, after `docs/alza_mvp.html`: pill buttons (52 px), cards with
 * 18 px corners, a bottom sheet on the native <dialog> (focus trap, Esc and background inert for
 * free) and the loading, empty and error states. Targets are at least 44 px (RNF-07).
 */
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';
import { AlertIcon, CloseIcon } from './icons';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'quiet'
  | 'danger-quiet';

const BASE =
  'inline-flex min-h-13 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold no-underline transition-[background-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-purple text-white border-b-4 border-[#4e0090] hover:bg-[#5c00a0]',
  secondary: 'bg-[#eef2f8] text-navy hover:bg-[#e2e8f3]',
  outline: 'border border-border bg-white text-navy hover:bg-blue-soft',
  danger: 'bg-danger text-white border-b-4 border-[#8a1a12] hover:bg-[#9a1e14]',
  quiet: 'bg-transparent text-purple hover:bg-lav-soft',
  'danger-quiet': 'bg-transparent text-danger hover:bg-[#fdecea]',
};

export function buttonClass(variant: ButtonVariant = 'primary', block = true): string {
  return `${BASE} ${VARIANTS[variant]} ${block ? 'w-full' : ''}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  block = true,
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant, block)} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-5" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} motion-safe:animate-spin`}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  return (
    <Tag className={`rounded-[18px] border border-border bg-card p-4 ${className}`}>{children}</Tag>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mx-1 mt-1 mb-3 text-2xl leading-tight font-bold text-text">{children}</h1>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-1 mt-6 mb-2.5 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}

/** Loading placeholders shaped like the cards that will come. */
export function Skeleton({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          key={i}
          className={`rounded-[18px] bg-[#e9edf5] motion-safe:animate-pulse ${tall && i === 0 ? 'h-40' : 'h-20'}`}
        />
      ))}
    </div>
  );
}

export function Loading({ rows, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <Skeleton rows={rows} tall={tall} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-[#fdecea] text-danger">
        <AlertIcon />
      </span>
      <p className="text-base text-text" role="alert">
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" block={false} onClick={onRetry}>
          Intentar de nuevo
        </Button>
      )}
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="mb-1 grid size-14 place-items-center rounded-full bg-lav-soft text-purple">
        {icon}
      </span>
      <p className="text-lg font-semibold text-text">{title}</p>
      {children && <div className="text-base text-muted">{children}</div>}
      {action && <div className="mt-3 w-full">{action}</div>}
    </div>
  );
}

/** Amber box for things to review, with an icon so it never depends on color alone. */
export function Notice({
  children,
  tone = 'warn',
}: {
  children: ReactNode;
  tone?: 'warn' | 'info' | 'ok';
}) {
  const styles = {
    warn: 'border-[#f2c894] bg-[#fdf3e7] text-[#8a3f06]',
    info: 'border-[#c9d6f5] bg-blue-soft text-navy',
    ok: 'border-[#b7e4d2] bg-[#e8f6f0] text-ok',
  }[tone];
  return (
    <div className={`flex gap-2.5 rounded-[14px] border px-3.5 py-3 text-[15px] ${styles}`}>
      <span className="mt-0.5 shrink-0">
        {tone === 'warn' ? <AlertIcon className="size-5" /> : <InfoDot />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function InfoDot() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Inline form error, announced. */
export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-[15px] text-danger">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Bottom sheet (`.mdl` in the mockup) on a modal <dialog>. Content mounts only while open, so each
 * opening starts clean.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** False while a request is running, so a tap outside does not lose it. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches taps on the backdrop; Esc closes through onCancel
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
      className="alza-sheet fixed inset-0 mx-auto mt-auto mb-0 max-h-[92dvh] w-full max-w-110 overflow-y-auto rounded-t-3xl bg-card p-0 text-text shadow-[0_-12px_32px_rgba(16,23,47,0.18)] backdrop:bg-[rgba(16,23,47,0.45)] sm:mb-auto sm:rounded-3xl"
    >
      {open && (
        <div className="px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 id={titleId} className="pt-2 text-[22px] leading-tight font-bold text-navy">
              {title}
            </h2>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-xl text-text hover:bg-bg"
              >
                <CloseIcon />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** «Antes y después» of a change (HU-11, 12.2 Chat), shown before she confirms. */
export function BeforeAfter({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-[14px] bg-bg px-4 py-3 text-base">
      <dt className="font-semibold text-muted">Antes</dt>
      <dd className="min-w-0">{before}</dd>
      <dt className="font-semibold text-muted">Después</dt>
      <dd className="min-w-0 font-semibold">{after}</dd>
    </dl>
  );
}
