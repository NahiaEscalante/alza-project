import { Link } from 'wouter';
import type { EntryView } from '../lib/types';
import { BankIcon, ChevronRightIcon, CoinsIcon, PhoneIcon } from './icons';
import { Money } from './money';
import { EntryTags } from './tags';

export function MethodIcon({ entry }: { entry: Pick<EntryView, 'paymentMethod'> }) {
  const Icon =
    entry.paymentMethod === 'cash'
      ? CoinsIcon
      : entry.paymentMethod === 'bank_transfer'
        ? BankIcon
        : PhoneIcon;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f2ebff] text-purple">
      <Icon className="size-5.5" />
    </span>
  );
}

/** «Ana T.» or, without a name, the type («Venta»). */
export function entryTitle(entry: EntryView): string {
  return entry.counterparty ?? entry.categoryText;
}

/** «10:42 · Yape · Venta». */
export function entryMeta(entry: EntryView): string {
  return [entry.time, entry.paymentMethodText, entry.counterparty ? entry.categoryText : null]
    .filter(Boolean)
    .join(' · ');
}

/** Amount with its sign; muted when it does not count (por confirmar, personal, interno). */
export function EntryAmount({ entry, className = '' }: { entry: EntryView; className?: string }) {
  const tone = !entry.countsInTotals
    ? 'text-muted'
    : entry.direction === 'in'
      ? 'text-ok'
      : 'text-text';
  return (
    <Money
      cents={entry.amountCents}
      sign={entry.direction}
      className={`font-semibold ${tone} ${className}`}
    />
  );
}

/** A record in a day (12.2 «Dentro de un día»). */
export function EntryRow({ entry, href }: { entry: EntryView; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3 rounded-[14px] border border-border bg-card p-3 text-left hover:border-[#cfd6e6]"
      >
        <MethodIcon entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <b className="truncate text-base font-semibold">{entryTitle(entry)}</b>
            <EntryAmount entry={entry} className="text-base" />
          </span>
          <span className="block text-sm text-muted">{entryMeta(entry)}</span>
          <EntryTags entry={entry} className="mt-0.5" />
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}
