/**
 * Demo tools (17.6): run the 12:00 close finalization for a day, the antifraud scan, and the
 * WA-17 notice. Each one asks for confirmation and is logged with who ran it.
 */
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  Badge,
  Btn,
  ConfirmDialog,
  ErrorBox,
  Flash,
  Loading,
  Notice,
  PageHeader,
  Panel,
} from '../components';
import { adminApi, errorText, useAdminApi } from '../lib/api';
import { dateTime, day } from '../lib/format';
import type { ToolRunResponse, ToolsResponse } from '../lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUMMARY_LABEL: Record<string, string> = {
  lastDay: 'Último día finalizable',
  users: 'Usuarias revisadas',
  daysFinalized: 'Días finalizados',
  pointsAwarded: 'Puntos otorgados',
  weeklyBonuses: 'Bonos semanales',
  usersWithheld: 'Usuarias sin puntos (alerta abierta)',
  deferredUsers: 'Usuarias en espera',
  failedUsers: 'Usuarias con error',
  sharedScreenshot: 'Misma captura en otra cuenta',
  activitySpike: 'Saltos de actividad',
  instantCloseReplies: 'Respuestas instantáneas',
  sent: 'Enviados',
  skipped: 'Omitidos',
  failed: 'Fallidos',
};

type Flashed = { tone: 'ok' | 'error'; text: string } | null;

function Summary({ title, values }: { title: string; values: Record<string, number | string> }) {
  return (
    <div className="mt-4 rounded-xl bg-[#f6f8fc] px-4 py-3">
      <p className="text-sm font-semibold text-text">{title}</p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{SUMMARY_LABEL[key] ?? key}</dt>
            <dd className="text-right font-semibold tabular-nums">
              {key === 'lastDay' && typeof value === 'string' ? day(value) : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ScopePicker({
  name,
  all,
  setAll,
  userId,
  setUserId,
}: {
  name: string;
  all: boolean;
  setAll: (value: boolean) => void;
  userId: string;
  setUserId: (value: string) => void;
}) {
  const inputId = useId();
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-text">¿Para quién?</legend>
      <div className="mt-2 flex flex-col gap-2 text-[15px]">
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={!all} onChange={() => setAll(false)} />
          Una usuaria
        </label>
        {!all && (
          <div className="ml-6">
            <label htmlFor={inputId} className="sr-only">
              Id de la usuaria
            </label>
            <input
              id={inputId}
              value={userId}
              onChange={(e) => setUserId(e.target.value.trim())}
              placeholder="Id de la usuaria (uuid)"
              spellCheck={false}
              className="w-full max-w-md rounded-lg border border-border px-3 py-2 font-mono text-sm outline-none focus:border-purple focus:ring-2 focus:ring-lav"
            />
          </div>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={all} onChange={() => setAll(true)} />
          Todas las usuarias
        </label>
      </div>
    </fieldset>
  );
}

function ToolCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel title={title} aside={badge}>
      <div className="px-4 py-4">{children}</div>
    </Panel>
  );
}

/** `datetime-local` value one hour ago, in the browser's time (the team is in Lima). */
function anHourAgo(): string {
  const d = new Date(Date.now() - 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ToolsScreen() {
  const { data, error, reload } = useAdminApi<ToolsResponse>('/tools');
  const [flash, setFlash] = useState<Flashed>(null);

  // Close finalization
  const [finalizeDay, setFinalizeDay] = useState('');
  const [finalizeAll, setFinalizeAll] = useState(false);
  const [finalizeUser, setFinalizeUser] = useState('');
  const [finalizeResult, setFinalizeResult] = useState<ToolRunResponse | null>(null);

  // Antifraud
  const [scanAll, setScanAll] = useState(true);
  const [scanUser, setScanUser] = useState('');
  const [scanResult, setScanResult] = useState<ToolRunResponse | null>(null);

  // WA-17
  const [startedAt, setStartedAt] = useState(anHourAgo);
  const [noticeResult, setNoticeResult] = useState<Record<string, number> | null>(null);

  const [confirm, setConfirm] = useState<'finalize' | 'scan' | 'notice' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && finalizeDay === '') setFinalizeDay(data.today);
  }, [data, finalizeDay]);

  const finalizeReady = finalizeAll || UUID.test(finalizeUser);
  const scanReady = scanAll || UUID.test(scanUser);

  async function run() {
    const action = confirm;
    if (!action) return;
    setBusy(true);
    setFlash(null);
    try {
      if (action === 'finalize') {
        const res = await adminApi.post<ToolRunResponse>('/tools/close-finalize', {
          confirm: true,
          businessDay: finalizeDay,
          ...(finalizeAll ? { allUsers: true } : { userId: finalizeUser }),
        });
        setFinalizeResult(res);
        setFlash({ tone: 'ok', text: `Cierres finalizados con la hora ${dateTime(res.ranAt)}.` });
      } else if (action === 'scan') {
        const res = await adminApi.post<ToolRunResponse>('/tools/antifraud-scan', {
          confirm: true,
          ...(scanAll ? { allUsers: true } : { userId: scanUser }),
        });
        setScanResult(res);
        setFlash({ tone: 'ok', text: 'Antifraude listo. Revisa las alertas nuevas.' });
      } else {
        const res = await adminApi.post<Record<string, number>>('/tools/technical-issue', {
          confirm: true,
          startedAt: new Date(startedAt).toISOString(),
        });
        setNoticeResult(res);
        setFlash({ tone: 'ok', text: `Aviso WA-17 enviado a ${res.sent ?? 0} usuarias.` });
      }
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const dayInputId = useId();
  const startedInputId = useId();
  const pastDeadline = data && finalizeDay !== '' && finalizeDay <= data.lastFinalizableDay;

  return (
    <>
      <PageHeader
        title="Herramientas demo"
        description="Para la demo y para soporte: corren al instante lo que normalmente pasa a su hora. Cada una pide confirmación y queda en el registro de acciones."
      />
      <Flash flash={flash} />
      {error && !data ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Panel>
          <Loading />
        </Panel>
      ) : (
        <div className="grid grid-cols-2 items-start gap-4">
          <ToolCard title="Finalizar cierres ahora">
            <p className="text-[15px] text-muted">
              Lo que hace la tarea de las 12:00: deja el día final con su nivel, da los puntos,
              mueve la racha y pasa las dudas a la web.
            </p>
            <label htmlFor={dayInputId} className="mt-4 block text-sm font-semibold text-text">
              Día del negocio
            </label>
            <input
              id={dayInputId}
              type="date"
              max={data.today}
              value={finalizeDay}
              onChange={(e) => setFinalizeDay(e.target.value)}
              className="mt-1.5 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-purple focus:ring-2 focus:ring-lav"
            />
            <p className="mt-1.5 text-xs text-muted">
              {pastDeadline
                ? 'Ya pasó su hora límite: se usa la hora actual.'
                : 'Todavía no son las 12:00 del día siguiente: se corre como si lo fueran (los puntos quedan con esa hora).'}
            </p>
            <ScopePicker
              name="finalize-scope"
              all={finalizeAll}
              setAll={setFinalizeAll}
              userId={finalizeUser}
              setUserId={setFinalizeUser}
            />
            <Btn
              tone="primary"
              className="mt-5"
              disabled={!finalizeReady || finalizeDay === ''}
              onClick={() => setConfirm('finalize')}
            >
              Finalizar cierres
            </Btn>
            {finalizeResult && <Summary title="Resultado" values={finalizeResult.summary} />}
          </ToolCard>

          <div className="flex flex-col gap-4">
            <ToolCard title="Correr antifraude">
              <p className="text-[15px] text-muted">
                La revisión diaria de las 05:00 (13.4): misma captura en cuentas distintas, saltos
                de actividad y respuestas instantáneas al cierre. Solo crea alertas; no bloquea.
              </p>
              <ScopePicker
                name="scan-scope"
                all={scanAll}
                setAll={setScanAll}
                userId={scanUser}
                setUserId={setScanUser}
              />
              <Btn
                tone="primary"
                className="mt-5"
                disabled={!scanReady}
                onClick={() => setConfirm('scan')}
              >
                Correr antifraude
              </Btn>
              {scanResult && <Summary title="Alertas nuevas" values={scanResult.summary} />}
            </ToolCard>

            <ToolCard
              title="Aviso de problema técnico (WA-17)"
              badge={
                data.technicalIssue ? (
                  <Badge tone="ok">Conectado</Badge>
                ) : (
                  <Badge tone="neutral">No conectado</Badge>
                )
              }
            >
              <p className="text-[15px] text-muted">
                «Estamos con un problema técnico…». Solo si afecta a muchas usuarias; una vez por
                usuaria y por incidente, a quienes tienen mensajes esperando desde el inicio.
              </p>
              {data.technicalIssue ? (
                <>
                  <label
                    htmlFor={startedInputId}
                    className="mt-4 block text-sm font-semibold text-text"
                  >
                    Inicio del problema
                  </label>
                  <input
                    id={startedInputId}
                    type="datetime-local"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    className="mt-1.5 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-purple focus:ring-2 focus:ring-lav"
                  />
                  <div>
                    <Btn
                      tone="danger"
                      className="mt-5"
                      disabled={startedAt === ''}
                      onClick={() => setConfirm('notice')}
                    >
                      Enviar WA-17
                    </Btn>
                  </div>
                  {noticeResult && <Summary title="Resultado" values={noticeResult} />}
                </>
              ) : (
                <div className="mt-4">
                  <Notice>
                    Este servidor no tiene el canal de WhatsApp conectado al panel todavía. Se
                    activa al pasar `broadcastTechnicalIssue` en el arranque.
                  </Notice>
                </div>
              )}
            </ToolCard>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'finalize'
            ? '¿Finalizar los cierres?'
            : confirm === 'scan'
              ? '¿Correr el antifraude?'
              : '¿Enviar el aviso WA-17?'
        }
        confirmLabel={
          confirm === 'finalize' ? 'Finalizar' : confirm === 'scan' ? 'Correr' : 'Enviar aviso'
        }
        tone={confirm === 'notice' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
      >
        {confirm === 'finalize' && (
          <>
            Los días hasta el {finalizeDay ? day(finalizeDay) : '—'} de{' '}
            {finalizeAll ? <strong>todas las usuarias</strong> : 'esta usuaria'} quedan finales. Si
            no respondieron, quedan «sin cierre». No se puede deshacer.
          </>
        )}
        {confirm === 'scan' && 'Solo crea alertas para revisar. No cambia ninguna cuenta.'}
        {confirm === 'notice' &&
          'Les llega un mensaje de WhatsApp a las usuarias con mensajes esperando. Cada mensaje cuesta: úsalo solo si el problema es general.'}
      </ConfirmDialog>
    </>
  );
}
