/**
 * «+ Agregar algo que faltó» (D16, RF-WP-03): only on past days, saved as «Lo contaste tú» with her
 * PIN. Incoming payments are sales unless she says otherwise (D09); outgoing ones need a type.
 */
import { useId, useState } from 'react';
import { useLocation } from 'wouter';
import { Page } from '../components/shell';
import { Button, FieldError, Notice } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import {
  capitalize,
  dayLabel,
  longDayLabel,
  PARSE_AMOUNT_MESSAGES,
  parseAmountToCents,
  todayBusinessDay,
} from '../lib/format';
import { CATEGORY_HELP, CATEGORY_TEXT, METHOD_TEXT } from '../lib/labels';
import type { Category, Direction, PaymentMethod } from '../lib/types';
import { isPinCancelled, usePinGate } from '../state/pin';
import { useToast } from '../state/toast';

const METHODS: PaymentMethod[] = ['cash', 'yape', 'plin', 'bank_transfer'];
const CATEGORIES: Record<Direction, Category[]> = {
  in: ['sale', 'other_income'],
  out: ['inventory', 'expense', 'household'],
};

function Choice<T extends string>({
  name,
  value,
  current,
  onChange,
  children,
  hint,
  compact = false,
}: {
  name: string;
  value: T;
  current: T | null;
  onChange: (value: T) => void;
  children: string;
  hint?: string;
  /** Two per row with long words («Transferencia») on a 360 px phone. */
  compact?: boolean;
}) {
  const on = current === value;
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center rounded-[14px] border py-2.5 ${
        compact ? 'gap-2 px-3 text-[15px]' : 'gap-3 px-3.5'
      } ${on ? 'border-navy bg-blue-soft' : 'border-border bg-white'}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={on}
        onChange={() => onChange(value)}
        className={`${compact ? 'size-4' : 'size-5'} shrink-0 accent-navy`}
      />
      <span className="min-w-0">
        <span className={`block font-semibold ${compact ? '' : 'text-base'}`}>{children}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function AddEntryScreen({ date }: { date: string }) {
  const [, navigate] = useLocation();
  const withPin = usePinGate();
  const toast = useToast();
  const [direction, setDirection] = useState<Direction>('in');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [category, setCategory] = useState<Category | null>('sale');
  const [counterparty, setCounterparty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountId = useId();
  const dayHref = `/movimientos/${date}`;
  const isPast = date < todayBusinessDay();

  function chooseDirection(next: Direction) {
    setDirection(next);
    setCategory(next === 'in' ? 'sale' : null);
    setError(null);
  }

  async function submit() {
    const parsed = parseAmountToCents(amount);
    if (!parsed.ok) return setError(PARSE_AMOUNT_MESSAGES[parsed.error]);
    if (!category) return setError('Elige qué fue este pago.');
    setBusy(true);
    setError(null);
    try {
      await withPin(() =>
        api.post('/entries', {
          businessDay: date,
          amountCents: parsed.cents,
          direction,
          paymentMethod: method,
          category,
          counterparty: counterparty.trim() || null,
        }),
      );
      toast('Listo, lo agregaste como «Lo contaste tú».');
      navigate(dayHref, { replace: true });
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Agregar algo que faltó" back={dayHref}>
      <p className="mx-1 mt-1 mb-4 text-lg font-semibold">{capitalize(longDayLabel(date))}</p>
      {!isPast ? (
        <Notice>
          Solo puedes agregar registros en días pasados. Lo de hoy mándalo por WhatsApp.
        </Notice>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-base font-semibold">¿Qué pasó?</legend>
            <Choice name="direction" value="in" current={direction} onChange={chooseDirection}>
              Me pagaron
            </Choice>
            <Choice name="direction" value="out" current={direction} onChange={chooseDirection}>
              Pagué
            </Choice>
          </fieldset>

          <div>
            <label htmlFor={amountId} className="mb-2 block text-base font-semibold">
              Monto
            </label>
            <span className="flex items-center rounded-xl border border-border bg-white focus-within:outline-2 focus-within:outline-navy">
              <span className="pl-4 text-lg font-semibold text-muted">S/</span>
              <input
                id={amountId}
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                className="h-14 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-xl font-semibold tabular-nums outline-none placeholder:text-[#9aa4b8]"
              />
            </span>
          </div>

          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-base font-semibold">¿Cómo?</legend>
            {METHODS.map((value) => (
              <Choice
                key={value}
                name="method"
                value={value}
                current={method}
                onChange={setMethod}
                compact
              >
                {METHOD_TEXT[value]}
              </Choice>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-semibold">¿Qué fue?</legend>
            {CATEGORIES[direction].map((value) => (
              <Choice
                key={value}
                name="category"
                value={value}
                current={category}
                onChange={(next) => {
                  setCategory(next);
                  setError(null);
                }}
                hint={CATEGORY_HELP[value]}
              >
                {CATEGORY_TEXT[value]}
              </Choice>
            ))}
          </fieldset>

          <label className="flex flex-col gap-2">
            <span className="text-base font-semibold">
              {direction === 'in' ? '¿Quién te pagó?' : '¿A quién le pagaste?'}{' '}
              <span className="font-normal text-muted">(opcional)</span>
            </span>
            <input
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              maxLength={80}
              autoComplete="off"
              className="h-13 rounded-xl border border-border bg-white px-4 text-base outline-none focus:outline-2 focus:outline-navy"
            />
          </label>

          <p className="text-sm text-muted">
            Quedará con la etiqueta «Lo contaste tú» en el {dayLabel(date)}. Te pediremos tu PIN.
          </p>
          <FieldError>{error}</FieldError>
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </form>
      )}
    </Page>
  );
}
