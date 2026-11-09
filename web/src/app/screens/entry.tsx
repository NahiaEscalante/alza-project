/**
 * One record (12.2 «Al tocar un registro»): «Corregir monto», «Cambiar tipo», «Quitar», each with
 * «antes y después» and the PIN (RF-WP-03, HU-11, D16), and its history («Qué pasó con este
 * registro»): every version stays, nothing is erased.
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { EntryAmount, MethodIcon } from '../components/entry-row';
import { AlertIcon, ChevronRightIcon } from '../components/icons';
import { useMoneyText } from '../components/money';
import { PersonalRuleOfferBody } from '../components/personal-rule';
import { Page } from '../components/shell';
import { EntryTags } from '../components/tags';
import {
  BeforeAfter,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FieldError,
  Loading,
  SectionTitle,
  Sheet,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import {
  capitalize,
  dayLabel,
  formatAmount,
  formatDateTime,
  PARSE_AMOUNT_MESSAGES,
  parseAmountToCents,
} from '../lib/format';
import {
  CATEGORY_CHOICES,
  CATEGORY_HELP,
  CATEGORY_TEXT,
  DIRECTION_TEXT,
  LABEL_TEXT,
  METHOD_TEXT,
  SOURCE_TEXT,
} from '../lib/labels';
import type {
  Category,
  CounterpartyRulesResponse,
  EntryHistory,
  EntryView,
  PersonalRuleOffer,
} from '../lib/types';
import { useApi } from '../lib/use-api';
import { isPinCancelled, usePinGate } from '../state/pin';
import { useToast } from '../state/toast';

type Action = 'amount' | 'category' | 'void' | null;

export function EntryScreen({ date, entryId }: { date: string; entryId: string }) {
  const history = useApi<EntryHistory>(`/entries/${entryId}/history`);
  const [action, setAction] = useState<Action>(null);
  const [offer, setOffer] = useState<PersonalRuleOffer | null>(null);
  const [, navigate] = useLocation();
  const dayHref = `/movimientos/${date}`;

  const versions = history.data?.versions ?? [];
  const current = versions.at(-1);
  const live = current && (current.status === 'confirmed' || current.status === 'pending');

  /** After a correction the record has a new id: show that one. */
  function corrected(entry: EntryView) {
    setAction(null);
    if (entry.id === entryId) history.reload();
    else navigate(`${dayHref}/${entry.id}`, { replace: true });
  }

  async function checkPersonalOffer(entry: EntryView) {
    if (entry.direction !== 'in' || entry.category !== 'personal' || !entry.counterparty) return;
    try {
      const rules = await api.get<CounterpartyRulesResponse>('/counterparty-rules');
      const match = rules.offers.find(
        (candidate) => candidate.counterparty.toLowerCase() === entry.counterparty?.toLowerCase(),
      );
      setOffer(match ?? null);
    } catch {
      // The offer also waits in Pendientes.
    }
  }

  return (
    <Page title="Registro" back={dayHref}>
      {history.error ? (
        <ErrorState message={errorMessage(history.error)} onRetry={history.reload} />
      ) : !current ? (
        <Loading rows={3} tall />
      ) : (
        <>
          <EntryCard entry={current} />
          {!live && (
            <p className="mx-1 mt-3 text-base text-muted">
              {current.status === 'voided'
                ? 'Quitaste este registro. Ya no cuenta, pero queda guardado aquí.'
                : 'Este registro ya no está vigente.'}
            </p>
          )}
          {live && current.isPending && (
            <Link
              href="/pendientes"
              className="mt-3 flex min-h-13 items-center gap-2.5 rounded-[14px] border border-[#f2c894] bg-[#fdf3e7] px-4 text-[15px] font-semibold text-[#8a3f06]"
            >
              <AlertIcon className="size-5 shrink-0" />
              <span className="flex-1">Tenemos una duda sobre este registro. Respóndela aquí.</span>
              <ChevronRightIcon className="size-5 shrink-0" />
            </Link>
          )}
          {live && (
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="secondary" onClick={() => setAction('amount')}>
                Corregir monto
              </Button>
              <Button variant="secondary" onClick={() => setAction('category')}>
                Cambiar tipo
              </Button>
              <Button variant="danger-quiet" onClick={() => setAction('void')}>
                Quitar
              </Button>
              <p className="mx-1 text-sm text-muted">Para cambiar algo te pediremos tu PIN.</p>
            </div>
          )}

          <SectionTitle>Qué pasó con este registro</SectionTitle>
          <Timeline history={history.data as EntryHistory} />

          <Sheet open={action === 'amount'} onClose={() => setAction(null)} title="Corregir monto">
            <CorrectAmount entry={current} onDone={corrected} />
          </Sheet>
          <Sheet open={action === 'category'} onClose={() => setAction(null)} title="Cambiar tipo">
            <ChangeCategory
              entry={current}
              onDone={(entry) => {
                corrected(entry);
                void checkPersonalOffer(entry);
              }}
            />
          </Sheet>
          <Sheet
            open={action === 'void'}
            onClose={() => setAction(null)}
            title="¿Quitar este registro?"
          >
            <VoidEntry
              entry={current}
              onDone={() => {
                setAction(null);
                navigate(dayHref, { replace: true });
              }}
              onCancel={() => setAction(null)}
            />
          </Sheet>
          <Sheet open={offer !== null} onClose={() => setOffer(null)} title="¿Lo dejamos así?">
            {offer && <PersonalRuleOfferBody offer={offer} onDone={() => setOffer(null)} />}
          </Sheet>
        </>
      )}
    </Page>
  );
}

function EntryCard({ entry }: { entry: EntryView }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <MethodIcon entry={entry} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {entry.directionText} · {entry.paymentMethodText}
            {entry.time ? ` · ${entry.time}` : ''}
          </p>
          <p className="truncate text-lg font-semibold">
            {entry.counterparty ?? entry.categoryText}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[32px] leading-tight font-bold">
        <EntryAmount entry={entry} />
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
        <dt className="text-muted">Tipo</dt>
        <dd className="font-semibold">{entry.categoryText}</dd>
        <dt className="text-muted">Día</dt>
        <dd>{capitalize(dayLabel(entry.businessDay))}</dd>
        <dt className="text-muted">Etiqueta</dt>
        <dd>
          <EntryTags entry={entry} />
        </dd>
      </dl>
      {!entry.countsInTotals && entry.status === 'confirmed' && (
        <p className="mt-3 text-sm text-muted">Este registro no suma en tus totales.</p>
      )}
    </Card>
  );
}

function useSave(onSaved: (entry: EntryView) => void) {
  const withPin = usePinGate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(run: () => Promise<{ entry: EntryView }>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await withPin(run);
      toast(message);
      onSaved(result.entry);
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, save };
}

function CorrectAmount({ entry, onDone }: { entry: EntryView; onDone: (e: EntryView) => void }) {
  const moneyText = useMoneyText();
  const [text, setText] = useState(formatAmount(entry.amountCents));
  const { busy, error, setError, save } = useSave(onDone);
  const parsed = parseAmountToCents(text);
  const changed = parsed.ok && parsed.cents !== entry.amountCents;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parsed.ok) return setError(PARSE_AMOUNT_MESSAGES[parsed.error]);
        if (!changed) return setError('Es el mismo monto. Escribe el monto correcto.');
        void save(
          () => api.patch(`/entries/${entry.id}`, { amountCents: parsed.cents }),
          'Listo, corregiste el monto. El original queda en el historial.',
        );
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-base font-semibold">Monto correcto</span>
        <span className="flex items-center rounded-xl border border-border bg-white focus-within:outline-2 focus-within:outline-navy">
          <span className="pl-4 text-lg font-semibold text-muted">S/</span>
          <input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            inputMode="decimal"
            autoComplete="off"
            className="h-14 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-xl font-semibold tabular-nums outline-none"
            aria-invalid={error ? true : undefined}
          />
        </span>
      </label>
      <BeforeAfter
        before={`${moneyText(entry.amountCents)} · ${entry.labelText}`}
        after={
          changed && parsed.ok
            ? `${moneyText(parsed.cents)} · ${LABEL_TEXT.self_reported}`
            : 'Escribe el monto nuevo'
        }
      />
      <FieldError>{error}</FieldError>
      <Button type="submit" loading={busy}>
        Guardar cambio
      </Button>
    </form>
  );
}

function ChangeCategory({ entry, onDone }: { entry: EntryView; onDone: (e: EntryView) => void }) {
  const choices = CATEGORY_CHOICES[entry.direction];
  const [category, setCategory] = useState<Category>(entry.category);
  const { busy, error, setError, save } = useSave(onDone);
  const changed = category !== entry.category;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed) return setError('Elige un tipo distinto.');
        void save(
          () => api.patch(`/entries/${entry.id}`, { category }),
          'Listo, cambiaste el tipo. El original queda en el historial.',
        );
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-semibold">¿Qué fue este pago?</legend>
        {choices.map((choice) => (
          <label
            key={choice}
            className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[14px] border px-3.5 py-3 ${
              category === choice ? 'border-navy bg-blue-soft' : 'border-border bg-white'
            }`}
          >
            <input
              type="radio"
              name="category"
              value={choice}
              checked={category === choice}
              onChange={() => {
                setCategory(choice);
                setError(null);
              }}
              className="mt-1 size-5 shrink-0 accent-navy"
            />
            <span>
              <span className="block text-base font-semibold">{CATEGORY_TEXT[choice]}</span>
              <span className="block text-sm text-muted">{CATEGORY_HELP[choice]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <BeforeAfter
        before={`${entry.categoryText} · ${entry.labelText}`}
        after={
          changed
            ? `${CATEGORY_TEXT[category]} · ${LABEL_TEXT.self_reported}`
            : 'Elige el tipo nuevo'
        }
      />
      <FieldError>{error}</FieldError>
      <Button type="submit" loading={busy}>
        Guardar cambio
      </Button>
    </form>
  );
}

function VoidEntry({
  entry,
  onDone,
  onCancel,
}: {
  entry: EntryView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const moneyText = useMoneyText();
  const withPin = usePinGate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await withPin(() => api.post(`/entries/${entry.id}/void`));
      toast('Listo, quitaste el registro. Queda guardado en el historial.');
      onDone();
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BeforeAfter
        before={`${entry.directionText} ${moneyText(entry.amountCents)} · ${entry.paymentMethodText}${
          entry.counterparty ? ` · ${entry.counterparty}` : ''
        }`}
        after="Quitado: ya no suma en tus totales"
      />
      <p className="text-[15px] text-muted">
        No se borra: queda guardado en el historial de este registro.
      </p>
      <FieldError>{error}</FieldError>
      <Button variant="danger" loading={busy} onClick={() => void remove()}>
        Sí, quitarlo
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        No, dejarlo
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (traceability, D16)
// ---------------------------------------------------------------------------

interface Change {
  from: unknown;
  to: unknown;
}

const FIELD_ORDER = [
  'amountCents',
  'direction',
  'category',
  'paymentMethod',
  'businessDay',
  'label',
];

function Timeline({ history }: { history: EntryHistory }) {
  const moneyText = useMoneyText();
  const versions = new Map(history.versions.map((version) => [version.id, version]));
  const items: { key: string; at: string; title: string; lines: string[] }[] = [];

  const describe = (field: string, change: Change): string | null => {
    switch (field) {
      case 'amountCents':
        return `Monto: ${moneyText(change.from as number)} → ${moneyText(change.to as number)}`;
      case 'category':
        return `Tipo: ${CATEGORY_TEXT[change.from as Category] ?? change.from} → ${CATEGORY_TEXT[change.to as Category] ?? change.to}`;
      case 'direction':
        return `${DIRECTION_TEXT[change.from as 'in'] ?? change.from} → ${DIRECTION_TEXT[change.to as 'in'] ?? change.to}`;
      case 'paymentMethod':
        return `Medio: ${METHOD_TEXT[change.from as 'yape'] ?? change.from} → ${METHOD_TEXT[change.to as 'yape'] ?? change.to}`;
      case 'businessDay':
        return `Día: ${dayLabel(String(change.from))} → ${dayLabel(String(change.to))}`;
      case 'label':
        return `Ahora dice «${LABEL_TEXT[change.to as 'screenshot'] ?? change.to}»`;
      default:
        return null;
    }
  };

  for (const [index, event] of history.events.entries()) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    const byHer = event.actor.startsWith('user:');
    const key = `${event.entryId}-${index}`;
    switch (event.event) {
      case 'created': {
        if (typeof detail.replaces === 'string') {
          const changes = (detail.changes ?? {}) as Record<string, Change>;
          // jsonb does not keep key order: show the amount first and the new tag last.
          const lines = Object.entries(changes)
            .sort(([a], [b]) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))
            .map(([field, change]) => describe(field, change))
            .filter((line): line is string => line !== null);
          items.push({ key, at: event.at, title: byHer ? 'Lo cambiaste' : 'Se cambió', lines });
        } else {
          const source = (detail.source as string) ?? versions.get(event.entryId)?.source;
          const how = SOURCE_TEXT[source as keyof typeof SOURCE_TEXT] ?? '';
          items.push({ key, at: event.at, title: `Se anotó ${how}`.trim(), lines: [] });
        }
        break;
      }
      case 'voided':
        items.push({ key, at: event.at, title: byHer ? 'Lo quitaste' : 'Se quitó', lines: [] });
        break;
      case 'confirmed':
        items.push({ key, at: event.at, title: 'Se confirmó', lines: [] });
        break;
      case 'resolved':
        items.push({ key, at: event.at, title: 'Se resolvió una duda', lines: [] });
        break;
    }
  }

  if (items.length === 0) {
    return <EmptyState icon={<AlertIcon />} title="Sin cambios" />;
  }
  return (
    <ol className="rounded-[14px] border border-border bg-card px-4 py-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="relative ml-1 border-l-2 border-navy py-2.5 pl-4 before:absolute before:top-4 before:-left-1.5 before:size-2.5 before:rounded-full before:bg-navy"
        >
          <p className="text-sm text-muted tabular-nums">{formatDateTime(item.at)}</p>
          <p className="text-base font-semibold">{item.title}</p>
          {item.lines.map((line) => (
            <p key={line} className="text-[15px] text-text">
              {line}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}
