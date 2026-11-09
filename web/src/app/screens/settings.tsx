/**
 * Ajustes: daily summary with image or «solo texto» and the gallery help (RF-WP-09, D27),
 * additional Yape/Plin holders (≤ 2, RF-WP-10, D31), «personal» rules (RF-WP-08), hiding amounts
 * on this phone (RF-WP-11, D51), «salir de todos» (RF-WA-09) and deleting the account (RF-PV-01).
 * Every change asks for the PIN.
 */
import { type ReactNode, useId, useState } from 'react';
import { Page } from '../components/shell';
import {
  Button,
  Card,
  ErrorState,
  FieldError,
  Loading,
  SectionTitle,
  Sheet,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { CounterpartyRulesResponse, MessageResponse, SettingsView } from '../lib/types';
import { useApi } from '../lib/use-api';
import { useHideAmounts } from '../state/hide-amounts';
import { isPinCancelled, usePinGate } from '../state/pin';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';

export function SettingsScreen() {
  const settings = useApi<SettingsView>('/settings');
  const rules = useApi<CounterpartyRulesResponse>('/counterparty-rules');

  return (
    <Page title="Ajustes" back="/">
      {settings.error ? (
        <ErrorState message={errorMessage(settings.error)} onRetry={settings.reload} />
      ) : !settings.data ? (
        <Loading rows={4} />
      ) : (
        <>
          <BusinessCard settings={settings.data} />
          <SummarySection
            settings={settings.data}
            onSaved={(next) => settings.setData(() => next)}
          />
          <HoldersSection
            settings={settings.data}
            onSaved={(next) => settings.setData(() => next)}
          />
          {(rules.data?.rules.length ?? 0) > 0 && (
            <PersonalRulesSection
              rules={rules.data as CounterpartyRulesResponse}
              onChanged={rules.reload}
            />
          )}
          <HideAmountsSection />
          <SecuritySection />
        </>
      )}
    </Page>
  );
}

function usePinAction() {
  const withPin = usePinGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await withPin(action);
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function BusinessCard({ settings }: { settings: SettingsView }) {
  return (
    <Card>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        <dt className="text-muted">Negocio</dt>
        <dd className="font-semibold">{settings.businessName ?? '—'}</dd>
        <dt className="text-muted">Titular</dt>
        <dd className="font-semibold">{settings.accountHolderName ?? '—'}</dd>
        <dt className="text-muted">Cierre</dt>
        <dd className="font-semibold">{settings.closeTime ? `${settings.closeTime} h` : '—'}</dd>
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resumen del día (D27)
// ---------------------------------------------------------------------------

function SummarySection({
  settings,
  onSaved,
}: {
  settings: SettingsView;
  onSaved: (next: SettingsView) => void;
}) {
  const toast = useToast();
  const { busy, error, run } = usePinAction();
  const [helpOpen, setHelpOpen] = useState(false);

  async function choose(summaryImage: boolean) {
    if (summaryImage === settings.summaryImage || busy) return;
    const next = await run(() => api.patch<SettingsView>('/settings', { summaryImage }));
    if (next) {
      onSaved(next);
      toast(
        summaryImage
          ? 'Listo. Tu resumen llegará con imagen.'
          : 'Listo. Tu resumen llegará solo en texto.',
      );
    }
  }

  return (
    <section aria-labelledby="summary-title">
      <SectionTitle>
        <span id="summary-title">Resumen del día en el chat</span>
      </SectionTitle>
      <Card>
        <fieldset>
          <legend className="sr-only">Cómo quieres recibir tu resumen</legend>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-[#eef2f8] p-1">
            {[
              { value: true, label: 'Con imagen' },
              { value: false, label: 'Solo texto' },
            ].map((option) => {
              const on = settings.summaryImage === option.value;
              return (
                <label
                  key={option.label}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-base font-semibold ${
                    on ? 'border border-border bg-white text-navy' : 'text-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="summary"
                    className="sr-only"
                    checked={on}
                    disabled={busy}
                    onChange={() => void choose(option.value)}
                  />
                  {on && <span aria-hidden="true">✓</span>}
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-3 text-[15px] text-muted">
          {settings.summaryImage
            ? 'Cada noche te llega una imagen con tus números y el texto debajo.'
            : 'Cada noche te llega solo el texto, sin imagen.'}
        </p>
        <FieldError>{error}</FieldError>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="mt-2 inline-flex min-h-11 items-center text-left text-[15px] font-semibold text-purple underline-offset-4 hover:underline"
        >
          Que WhatsApp no guarde las imágenes en tu galería
        </button>
      </Card>
      <Sheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Que no se guarden en tu galería"
      >
        <GalleryHelp onClose={() => setHelpOpen(false)} />
      </Sheet>
    </section>
  );
}

function Steps({ title, steps }: { title: string; steps: ReactNode[] }) {
  return (
    <div>
      <h3 className="mb-2 text-base font-bold text-navy">{title}</h3>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list of steps
          <li key={i} className="grid grid-cols-[32px_1fr] items-start gap-3 text-[15px]">
            <span className="grid size-8 place-items-center rounded-full bg-navy text-sm font-bold text-white">
              {i + 1}
            </span>
            <span className="pt-1">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** D27 help. The menu names change between versions: she is told to check hers. */
function GalleryHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-muted">
        WhatsApp puede guardar en tu galería las imágenes que te llegan, y tu familia podría verlas.
        Puedes apagarlo solo para el chat de ALZA:
      </p>
      <Steps
        title="En Android"
        steps={[
          'Abre el chat de ALZA en WhatsApp.',
          'Toca el nombre «ALZA» arriba.',
          <>
            Entra a <b>Visibilidad de archivos multimedia</b>.
          </>,
          <>
            Elige <b>No</b> y toca <b>Aceptar</b>.
          </>,
        ]}
      />
      <Steps
        title="En iPhone"
        steps={[
          'Abre el chat de ALZA en WhatsApp.',
          'Toca el nombre «ALZA» arriba.',
          <>
            Entra a <b>Guardar en Fotos</b>.
          </>,
          <>
            Elige <b>Nunca</b>.
          </>,
        ]}
      />
      <p className="rounded-[14px] bg-bg px-4 py-3 text-sm text-muted">
        Los nombres pueden cambiar un poco: verifica en tu versión de WhatsApp. También puedes
        elegir «Solo texto» y no recibir imágenes.
      </p>
      <Button onClick={onClose}>Entendido</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Titulares adicionales (D31)
// ---------------------------------------------------------------------------

function HoldersSection({
  settings,
  onSaved,
}: {
  settings: SettingsView;
  onSaved: (next: SettingsView) => void;
}) {
  const toast = useToast();
  const { busy, error, setError, run } = usePinAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const inputId = useId();
  const holders = settings.additionalHolders;
  const canAdd = holders.length < settings.maxAdditionalHolders;

  async function save(list: string[], message: string) {
    const next = await run(() => api.patch<SettingsView>('/settings', { additionalHolders: list }));
    if (next) {
      onSaved(next);
      setAdding(false);
      setName('');
      toast(message);
    }
  }

  return (
    <section aria-labelledby="holders-title">
      <SectionTitle>
        <span id="holders-title">Titulares de Yape o Plin</span>
      </SectionTitle>
      <Card>
        <p className="text-[15px] text-muted">
          Si alguien de tu familia cobra con su Yape o Plin para tu negocio, agrégalo. Así sabremos
          que esos pagos son tuyos. Puedes agregar hasta {settings.maxAdditionalHolders}.
        </p>
        <ul className="mt-3 flex flex-col">
          <li className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2">
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {settings.accountHolderName ?? 'Tú'}
              </span>
              <span className="block text-sm text-muted">Titular principal</span>
            </span>
          </li>
          {holders.map((holder) => (
            <li
              key={holder.id}
              className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2"
            >
              <span className="min-w-0 truncate font-semibold">{holder.name}</span>
              <Button
                variant="danger-quiet"
                block={false}
                className="min-h-11 px-3 text-[15px]"
                disabled={busy}
                onClick={() =>
                  void save(
                    holders.filter((h) => h.id !== holder.id).map((h) => h.name),
                    `Listo, quitaste a ${holder.name}.`,
                  )
                }
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
        {adding ? (
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = name.replace(/\s+/g, ' ').trim();
              if (clean.length < 2)
                return setError('Escribe el nombre como aparece en Yape o Plin.');
              void save([...holders.map((h) => h.name), clean], `Listo, agregaste a ${clean}.`);
            }}
          >
            <label htmlFor={inputId} className="text-base font-semibold">
              Nombre como aparece en Yape o Plin
            </label>
            <input
              id={inputId}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={80}
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: she just tapped «Agregar titular»
              autoFocus
              className="h-13 rounded-xl border border-border bg-white px-4 text-base outline-none focus:outline-2 focus:outline-navy"
            />
            <FieldError>{error}</FieldError>
            <Button type="submit" loading={busy}>
              Guardar titular
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setName('');
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </form>
        ) : (
          <>
            <FieldError>{error}</FieldError>
            {canAdd ? (
              <Button variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
                Agregar titular
              </Button>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Ya tienes {settings.maxAdditionalHolders} titulares más, el máximo.
              </p>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pagos personales (RF-WP-08)
// ---------------------------------------------------------------------------

function PersonalRulesSection({
  rules,
  onChanged,
}: {
  rules: CounterpartyRulesResponse;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { busy, error, run } = usePinAction();
  return (
    <section aria-labelledby="rules-title">
      <SectionTitle>
        <span id="rules-title">Pagos que no cuentan como venta</span>
      </SectionTitle>
      <Card>
        <ul className="flex flex-col">
          {rules.rules.map((rule) => (
            <li
              key={rule.counterpartyKey}
              className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{rule.counterparty}</span>
                <span className="block text-sm text-muted">Sus pagos no cuentan como venta</span>
              </span>
              <Button
                variant="secondary"
                block={false}
                className="min-h-11 shrink-0 px-4 text-[15px]"
                disabled={busy}
                onClick={async () => {
                  const result = await run(() =>
                    api.post<MessageResponse>('/counterparty-rules/deactivate', {
                      counterpartyKey: rule.counterpartyKey,
                    }),
                  );
                  if (result) {
                    if (result.message) toast(result.message);
                    onChanged();
                  }
                }}
              >
                Desactivar
              </Button>
            </li>
          ))}
        </ul>
        <FieldError>{error}</FieldError>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ocultar montos (D51)
// ---------------------------------------------------------------------------

function HideAmountsSection() {
  const { hidden, toggle } = useHideAmounts();
  const labelId = useId();
  return (
    <section aria-labelledby="view-title">
      <SectionTitle>
        <span id="view-title">En este celular</span>
      </SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <span>
            <span id={labelId} className="block text-base font-semibold">
              Ocultar montos
            </span>
            <span className="block text-sm text-muted">
              Para que nadie vea tus montos en la pantalla. Solo en este celular.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={hidden}
            aria-labelledby={labelId}
            onClick={toggle}
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
              hidden ? 'bg-navy' : 'bg-[#c5cbe0]'
            } before:absolute before:-inset-1.5`}
          >
            <span
              className={`grid size-6 place-items-center rounded-full bg-white text-[11px] font-bold text-navy shadow transition-transform ${
                hidden ? 'translate-x-7' : 'translate-x-1'
              }`}
              aria-hidden="true"
            >
              {hidden ? '✓' : ''}
            </span>
          </button>
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Seguridad: salir de todos y borrar la cuenta
// ---------------------------------------------------------------------------

function SecuritySection() {
  const [sheet, setSheet] = useState<'logout' | 'delete' | null>(null);
  return (
    <section aria-labelledby="security-title">
      <SectionTitle>
        <span id="security-title">Tu cuenta</span>
      </SectionTitle>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setSheet('logout')}>
          Salir de todos los celulares
        </Button>
        <Button variant="danger-quiet" onClick={() => setSheet('delete')}>
          Borrar mi cuenta
        </Button>
      </div>
      <Sheet
        open={sheet === 'logout'}
        onClose={() => setSheet(null)}
        title="¿Salir de todos los celulares?"
      >
        <LogoutAll onCancel={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Borrar mi cuenta">
        <DeleteAccount onCancel={() => setSheet(null)} />
      </Sheet>
    </section>
  );
}

function LogoutAll({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useSession();
  const { busy, error, run } = usePinAction();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">
        Se cerrará tu sesión en este y en todos los celulares donde entraste. Para volver, abre el
        enlace de tu cierre y escribe tu PIN.
      </p>
      <FieldError>{error}</FieldError>
      <Button
        loading={busy}
        onClick={async () => {
          const result = await run(() => api.post<MessageResponse>('/auth/logout-all'));
          if (result)
            signOut({
              title: 'Sesión cerrada',
              message: `${result.message ?? 'Listo, cerraste tu sesión en todos tus celulares.'} Para volver a entrar, abre el enlace de tu último cierre o escribe «web» en el chat de ALZA.`,
              hint: 'web',
            });
        }}
      >
        Sí, salir de todos
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

const DELETE_WORD = 'BORRAR';

/** RF-PV-01: two steps, then the PIN. */
function DeleteAccount({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useSession();
  const { busy, error, setError, run } = usePinAction();
  const [step, setStep] = useState<1 | 2>(1);
  const [word, setWord] = useState('');
  const inputId = useId();

  if (step === 1) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base">Si borras tu cuenta:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-muted">
          <li>Se borran tus registros, tus capturas y tus audios.</li>
          <li>Pierdes tus puntos y tu racha.</li>
          <li>No se puede deshacer.</li>
        </ul>
        <p className="text-[15px] text-muted">
          Si quieres guardar tu historial, descárgalo antes desde Movimientos.
        </p>
        <Button variant="danger" onClick={() => setStep(2)}>
          Sí, quiero borrar mi cuenta
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          No, volver
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (word.trim().toUpperCase() !== DELETE_WORD) {
          return setError(`Escribe ${DELETE_WORD} para confirmar.`);
        }
        const result = await run(() =>
          api.post<MessageResponse>('/account/delete', { confirm: true }),
        );
        if (result) {
          signOut({
            title: 'Hasta pronto',
            message: result.message ?? 'Listo, borré tus datos. Gracias por usar ALZA.',
            hint: null,
          });
        }
      }}
    >
      <label htmlFor={inputId} className="text-base">
        Para confirmar, escribe <b>{DELETE_WORD}</b>:
      </label>
      <input
        id={inputId}
        value={word}
        onChange={(event) => {
          setWord(event.target.value);
          setError(null);
        }}
        autoComplete="off"
        autoCapitalize="characters"
        className="h-13 rounded-xl border border-border bg-white px-4 text-base font-semibold tracking-wide outline-none focus:outline-2 focus:outline-navy"
      />
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="danger" loading={busy}>
        Borrar mi cuenta para siempre
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}
