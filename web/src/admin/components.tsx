/**
 * Building blocks of the internal panel: desktop-first and compact, with the same tokens as the
 * user's web (`index.css`). Buttons are at least 36 px tall; the confirm dialog uses the native
 * <dialog> (focus trap and Esc for free).
 */
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON: Record<Tone, string> = {
  primary: 'bg-purple text-white hover:bg-[#5c00a0]',
  secondary: 'border border-border bg-white text-navy hover:bg-blue-soft',
  danger: 'bg-danger text-white hover:bg-[#9a1e14]',
  ghost: 'text-purple hover:bg-lav-soft',
};

export function Btn({
  tone = 'secondary',
  busy = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${BUTTON[tone]} ${className}`}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} motion-safe:animate-spin`} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-bold text-navy">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE = {
  neutral: 'bg-[#eef2f8] text-navy',
  warn: 'bg-[#fdf3e7] text-[#8a3f06]',
  danger: 'bg-[#fdecea] text-danger',
  ok: 'bg-[#e8f6f0] text-ok',
  purple: 'bg-lav-soft text-purple',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof BADGE;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE[tone]}`}
    >
      {children}
    </span>
  );
}

/** Ids in a monospace face, shortened; the full value is in the tooltip. */
export function Id({ value, full = false }: { value: string | null; full?: boolean }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <code
      title={value}
      className="rounded bg-[#f1f4f9] px-1.5 py-0.5 font-mono text-[13px] text-text"
    >
      {full ? value : value.slice(0, 8)}
    </code>
  );
}

/** User id with her masked phone under it (RNF-09: never the full number). */
export function UserCell({ userId, phone }: { userId: string | null; phone: string | null }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Id value={userId} />
      <span className="text-xs whitespace-nowrap text-muted">{phone ?? '—'}</span>
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-[#f9fafc] text-xs font-semibold tracking-wide text-muted uppercase">
            {head.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static header
              <th key={i} scope="col" className="px-3 py-2.5 font-semibold first:pl-4 last:pr-4">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle [&_td:first-child]:pl-4 [&_td:last-child]:pr-4">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10! text-center text-muted">
        {children}
      </td>
    </tr>
  );
}

export function Loading() {
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-8 text-muted">
      <Spinner /> Cargando…
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-[#f3c1bb] bg-[#fdecea] px-4 py-3 text-sm text-danger"
    >
      <span>{message}</span>
      {onRetry && (
        <Btn tone="secondary" onClick={onRetry}>
          Intentar de nuevo
        </Btn>
      )}
    </div>
  );
}

/** Result of the last action, announced to screen readers. */
export function Flash({ flash }: { flash: { tone: 'ok' | 'error'; text: string } | null }) {
  return (
    <div aria-live="polite" className="mb-4 empty:hidden">
      {flash && (
        <p
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            flash.tone === 'ok'
              ? 'border-[#b7e4d2] bg-[#e8f6f0] text-ok'
              : 'border-[#f3c1bb] bg-[#fdecea] text-danger'
          }`}
        >
          {flash.text}
        </p>
      )}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-[#c9d6f5] bg-blue-soft px-4 py-2.5 text-sm text-navy">
      {children}
    </p>
  );
}

/** «¿Seguro?» before anything that changes data. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-full max-w-lg rounded-2xl bg-card p-0 text-text shadow-[0_16px_48px_rgba(16,23,47,0.22)] backdrop:bg-[rgba(16,23,47,0.45)]"
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-bold text-navy">
            {title}
          </h2>
          <div className="mt-2 text-[15px] text-muted">{children}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Btn onClick={onCancel} disabled={busy}>
              Cancelar
            </Btn>
            <Btn tone={tone} onClick={onConfirm} busy={busy} disabled={confirmDisabled}>
              {confirmLabel}
            </Btn>
          </div>
        </div>
      )}
    </dialog>
  );
}
