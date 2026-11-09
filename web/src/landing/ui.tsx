import type { ReactNode } from 'react';

const NBSP = '\u00A0';

/** «S/ 2 140» for sample amounts: thin groups with no-break spaces, so it never wraps. */
export function soles(amount: string): string {
  return `S/${NBSP}${amount.replace(/ /g, NBSP)}`;
}

/** Integer with «2 160» grouping (the spec's format), no-break. */
export function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function Section({
  id,
  className = '',
  children,
  labelledBy,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`scroll-mt-16 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

export function Eyebrow({
  children,
  tone = 'purple',
}: {
  children: ReactNode;
  tone?: 'purple' | 'light';
}) {
  return (
    <p
      className={`text-sm font-bold uppercase tracking-[0.08em] ${tone === 'light' ? 'text-[#c9b6ff]' : 'text-purple'}`}
    >
      {children}
    </p>
  );
}

/** «De ejemplo»: everything simulated says so on screen (principle 6, 3.2). */
export function ExampleTag({ children = 'Datos de ejemplo' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eef2f8] px-3 py-1 text-sm font-semibold text-muted">
      <span className="size-1.5 rounded-full bg-gray" aria-hidden="true" />
      {children}
    </span>
  );
}

const BUTTON_BASE =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-6 text-base font-semibold no-underline transition-[transform,background-color,box-shadow] duration-150 active:translate-y-px';

export const BUTTON_PRIMARY = `${BUTTON_BASE} bg-purple text-white border-b-4 border-[#4e0090] hover:bg-[#5c00a0] shadow-[0_10px_24px_-12px_rgba(106,0,184,0.7)]`;

export const BUTTON_SECONDARY = `${BUTTON_BASE} bg-[#eef2f8] text-navy hover:bg-[#e2e8f3]`;
