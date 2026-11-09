/**
 * Pendientes (RF-WP-04): open doubts and the payments of her list that she never sent, resolved
 * with taps (the options come from the server, 11.8). Also the «personal» rule offer (RF-WP-08).
 */
import { useId, useState } from 'react';
import { EntryAmount, entryMeta, entryTitle, MethodIcon } from '../components/entry-row';
import { CheckIcon } from '../components/icons';
import { PersonalRuleOfferBody } from '../components/personal-rule';
import { Page } from '../components/shell';
import { EntryTags } from '../components/tags';
import { Button, EmptyState, ErrorState, FieldError, Loading } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import {
  capitalize,
  PARSE_AMOUNT_MESSAGES,
  parseAmountToCents,
  todayBusinessDay,
} from '../lib/format';
import type {
  CounterpartyRulesResponse,
  PendingItem,
  PendingOption,
  PendingResponse,
  ResolveResponse,
} from '../lib/types';
import { useApi } from '../lib/use-api';
import { useToast } from '../state/toast';

const OUTCOME_TEXT: Record<string, string> = {
  duplicate: 'Listo, lo dejamos como el mismo pago.',
  dismissed: 'Listo, no lo contamos.',
  created: 'Listo, lo anotamos.',
  already_recorded: 'Ese pago ya estaba anotado.',
};

export function PendingScreen() {
  const pending = useApi<PendingResponse>('/pending');
  const rules = useApi<CounterpartyRulesResponse>('/counterparty-rules');
  const toast = useToast();

  const items = pending.data?.items ?? [];
  const offers = rules.data?.offers ?? [];

  return (
    <Page title="Pendientes" back="/">
      <p className="mx-1 mt-1 mb-4 text-base text-muted">
        Cosas que faltan revisar. Respóndelas con un toque.
      </p>
      {pending.error ? (
        <ErrorState message={errorMessage(pending.error)} onRetry={pending.reload} />
      ) : !pending.data ? (
        <Loading rows={3} tall />
      ) : items.length === 0 && offers.length === 0 ? (
        <EmptyState icon={<CheckIcon />} title="No tienes nada por revisar">
          Cuando tengamos una duda sobre tus registros, aparecerá aquí.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {offers.map((offer) => (
            <li
              key={offer.counterpartyKey}
              className="rounded-[18px] border border-[#c9d6f5] bg-blue-soft p-4"
            >
              <p className="mb-2 text-sm font-semibold text-navy">Pagos personales</p>
              <PersonalRuleOfferBody offer={offer} onDone={rules.reload} />
            </li>
          ))}
          {items.map((item) => (
            <PendingCard
              key={item.id}
              item={item}
              onResolved={(result) => {
                toast(OUTCOME_TEXT[result.outcome] ?? 'Listo, resuelto.');
                pending.setData((current) =>
                  current
                    ? {
                        ...current,
                        ...result.pending,
                        items: current.items.filter((candidate) => candidate.id !== item.id),
                      }
                    : current,
                );
              }}
            />
          ))}
        </ul>
      )}
    </Page>
  );
}

function PendingCard({
  item,
  onResolved,
}: {
  item: PendingItem;
  onResolved: (result: ResolveResponse) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function resolve(index: number, option: PendingOption) {
    const body: Record<string, unknown> = { ...option.resolution };
    if (option.input === 'amount') {
      const parsed = parseAmountToCents(value);
      if (!parsed.ok) return setError(PARSE_AMOUNT_MESSAGES[parsed.error]);
      body.amountCents = parsed.cents;
    } else if (option.input === 'day') {
      if (!value) return setError('Elige el día.');
      body.businessDay = value;
    }
    setBusy(index);
    setError(null);
    try {
      onResolved(await api.post<ResolveResponse>(`/pending/${item.id}/resolve`, body));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const selected = open === null ? null : item.options[open];

  return (
    <li className="rounded-[18px] border border-[#f2c894] bg-[#fdf3e7] p-4">
      <p className="text-sm font-semibold text-[#8a3f06]">{capitalize(item.dayLabel)}</p>
      <p className="mt-1 text-[17px] font-semibold text-text">{item.question}</p>
      {item.hint && <p className="mt-1 text-[15px] text-muted">{item.hint}</p>}

      {item.entry && (
        <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-white p-3">
          <MethodIcon entry={item.entry} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline justify-between gap-2">
              <b className="truncate font-semibold">{entryTitle(item.entry)}</b>
              <EntryAmount entry={item.entry} />
            </p>
            <p className="text-sm text-muted">{entryMeta(item.entry)}</p>
            <EntryTags entry={item.entry} />
          </div>
        </div>
      )}

      {selected?.input ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void resolve(open as number, selected);
          }}
        >
          <label htmlFor={inputId} className="text-base font-semibold">
            {selected.input === 'amount' ? '¿De cuánto era?' : '¿De qué día es?'}
          </label>
          {selected.input === 'amount' ? (
            <span className="flex items-center rounded-xl border border-border bg-white focus-within:outline-2 focus-within:outline-navy">
              <span className="pl-4 text-lg font-semibold text-muted">S/</span>
              <input
                id={inputId}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                // biome-ignore lint/a11y/noAutofocus: she just tapped «Escribir el monto»
                autoFocus
                className="h-13 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-lg font-semibold tabular-nums outline-none placeholder:text-[#9aa4b8]"
              />
            </span>
          ) : (
            <input
              id={inputId}
              type="date"
              value={value}
              max={todayBusinessDay()}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              className="h-13 rounded-xl border border-border bg-white px-4 text-base outline-none focus:outline-2 focus:outline-navy"
            />
          )}
          <FieldError>{error}</FieldError>
          <Button type="submit" loading={busy !== null}>
            Guardar
          </Button>
          <Button
            variant="quiet"
            disabled={busy !== null}
            onClick={() => {
              setOpen(null);
              setValue('');
              setError(null);
            }}
          >
            Volver a las opciones
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {/* On a computer the answers sit side by side (D79). */}
          <div className="contents lg:grid lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] lg:gap-3">
            {item.options.map((option, index) => (
              <Button
                key={option.label}
                variant="outline"
                loading={busy === index}
                disabled={busy !== null}
                onClick={() => {
                  if (option.input) {
                    setOpen(index);
                    setValue('');
                    setError(null);
                  } else void resolve(index, option);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <FieldError>{error}</FieldError>
        </div>
      )}
    </li>
  );
}
