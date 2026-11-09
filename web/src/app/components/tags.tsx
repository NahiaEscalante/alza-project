/**
 * Visible tags (PR12, 11.3) and close levels (Anexo A). Each one has a shape and a text, never
 * only a color (RNF-07): ✓ «Con captura», ○ «Lo contaste tú», ▲ «Por confirmar» / «Caja sin
 * revisar».
 */
import type { CloseLevel, EntryView } from '../lib/types';
import { ClockIcon } from './icons';

type TagTone = 'ok' | 'self' | 'warn' | 'note';

const TONE: Record<TagTone, string> = {
  ok: 'text-ok',
  self: 'text-gray',
  warn: 'text-warn',
  note: 'text-muted',
};

function Shape({ tone }: { tone: TagTone }) {
  switch (tone) {
    case 'ok':
      return (
        <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
          <path
            d="M2 6.5l2.5 2.5L10 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'self':
      return (
        <svg viewBox="0 0 12 12" className="size-2.5 shrink-0" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'warn':
      return (
        <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
          <path d="M6 1.5l5 9H1z" fill="currentColor" />
        </svg>
      );
    case 'note':
      return <ClockIcon className="size-3.5 shrink-0" />;
  }
}

export function Tag({ tone, children }: { tone: TagTone; children: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-semibold leading-5 ${TONE[tone]}`}
    >
      <Shape tone={tone} />
      {children}
    </span>
  );
}

/** The tags of one entry, from its fields (texts from the server). */
export function EntryTags({ entry, className = '' }: { entry: EntryView; className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 ${className}`}>
      <Tag tone={entry.label === 'screenshot' ? 'ok' : 'self'}>{entry.labelText}</Tag>
      {entry.isPending && <Tag tone="warn">Por confirmar</Tag>}
      {entry.afterClose && <Tag tone="note">Agregado después del cierre</Tag>}
    </span>
  );
}

/** «completo», «a medias», «sin cierre» with their own shape. */
export function LevelBadge({
  level,
  text,
  isToday = false,
}: {
  level: CloseLevel | null;
  text: string | null;
  isToday?: boolean;
}) {
  if (!level) {
    if (!isToday) return null;
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
        <ClockIcon className="size-4" />
        Hoy, en curso
      </span>
    );
  }
  const label = text ?? level;
  if (level === 'complete') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path
            d="M4.5 8.3l2.2 2.2 4.8-4.8"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Cierre {label}
      </span>
    );
  }
  if (level === 'partial') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warn">
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </svg>
        Cierre {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray">
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeDasharray="3 2.2"
        />
      </svg>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}
