/**
 * Entró / Salió / Te quedó (11.6, Anexo A) as rows, like the 12.2 wireframe: the amounts get the
 * full width, so «S/ 12 345,50» never overflows on a 360 px phone.
 */
import { Money } from './money';

function Row({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${
        strong ? 'mt-1 border-t border-border pt-2.5' : ''
      }`}
    >
      <dt className={strong ? 'text-base font-semibold text-text' : 'text-[15px] text-muted'}>
        {label}
      </dt>
      <dd className={strong ? 'text-lg font-bold text-navy' : 'text-[17px] font-semibold'}>
        <Money cents={cents} />
      </dd>
    </div>
  );
}

export function Totals({
  inCents,
  outCents,
  leftCents,
}: {
  inCents: number;
  outCents: number;
  leftCents: number;
}) {
  return (
    <dl>
      <Row label="Entró" cents={inCents} />
      <Row label="Salió" cents={outCents} />
      <Row label="Te quedó" cents={leftCents} strong />
    </dl>
  );
}

/** One line, wrapping between pairs: «Entró S/ 2 278 · Salió S/ 490 · Te quedó S/ 1 788». */
export function TotalsLine({
  inCents,
  outCents,
  leftCents,
}: {
  inCents: number;
  outCents: number;
  leftCents: number;
}) {
  const pairs: [string, number][] = [
    ['Entró', inCents],
    ['Salió', outCents],
    ['Te quedó', leftCents],
  ];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[15px] text-muted">
      {pairs.map(([label, cents]) => (
        <span key={label} className="whitespace-nowrap">
          {label} <Money cents={cents} className="font-semibold text-text" />
        </span>
      ))}
    </p>
  );
}
