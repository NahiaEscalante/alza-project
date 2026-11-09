import { formatSoles } from '../lib/format';
import { useHideAmounts } from '../state/hide-amounts';

export const HIDDEN_AMOUNT = 'S/ ••••';

/**
 * An amount in soles, or «S/ ••••» when she hid the amounts (RF-WP-11). `sign` adds «+» / «−» so
 * the direction never depends on color alone.
 */
export function Money({
  cents,
  sign,
  className = '',
}: {
  cents: number;
  sign?: 'in' | 'out';
  className?: string;
}) {
  const { hidden } = useHideAmounts();
  const prefix = sign === 'in' ? '+ ' : sign === 'out' ? '− ' : '';
  if (hidden) {
    return (
      <span className={`whitespace-nowrap ${className}`}>
        <span aria-hidden="true">
          {prefix}
          {HIDDEN_AMOUNT}
        </span>
        <span className="sr-only">Monto oculto</span>
      </span>
    );
  }
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {prefix}
      {formatSoles(cents)}
    </span>
  );
}

/** Plain-text version for sentences and aria-labels. */
export function useMoneyText(): (cents: number) => string {
  const { hidden } = useHideAmounts();
  return (cents) => (hidden ? HIDDEN_AMOUNT : formatSoles(cents));
}
