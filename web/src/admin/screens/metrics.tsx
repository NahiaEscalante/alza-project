/** RF-AD-03: the basic metrics of 13.5, aggregates only. */
import type { ReactNode } from 'react';
import { Btn, ErrorBox, Loading, PageHeader, Panel, Table } from '../components';
import { errorText, useAdminApi } from '../lib/api';
import { dateTime, day, decimal, percent, plural } from '../lib/format';
import type { MetricsResponse, Ratio } from '../lib/types';

function Metric({
  label,
  value,
  sub,
  how,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  how: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border p-4 ${
        highlight ? 'border-[#d9c6ff] bg-lav-soft' : 'border-border bg-card'
      }`}
    >
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-3xl leading-tight font-bold text-navy tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-text tabular-nums">{sub}</p>}
      <p className="mt-auto pt-3 text-xs text-muted">{how}</p>
    </div>
  );
}

const fraction = (r: Ratio, noun: string) => `${r.numerator} de ${r.denominator} ${noun}`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-xs font-bold tracking-wider text-muted uppercase">{title}</h2>
      <div className="grid grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

export function MetricsScreen() {
  const { data: m, error, loading, reload } = useAdminApi<MetricsResponse>('/metrics');

  return (
    <>
      <PageHeader
        title="Métricas"
        description={
          m
            ? `Calculadas el ${dateTime(m.generatedAt)} (hora de Lima). Solo conteos y tasas: sin montos, nombres ni textos.`
            : 'Métricas básicas de la sección 13.5.'
        }
        actions={
          <Btn onClick={reload} busy={loading && m !== undefined}>
            Actualizar
          </Btn>
        }
      />
      {error && !m ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : !m ? (
        <Panel>
          <Loading />
        </Panel>
      ) : (
        <>
          <Group title="Impacto (reto)">
            <Metric
              highlight
              label="Registro constante"
              value={m.impact.consistentRecording}
              sub={m.impact.consistentRecording === 1 ? 'usuaria' : 'usuarias'}
              how="Con 5 o más cierres completos por semana durante 4 semanas seguidas."
            />
            <Metric
              highlight
              label="Historial listo"
              value={m.impact.historyReady}
              sub={m.impact.historyReady === 1 ? 'usuaria' : 'usuarias'}
              how="Descargaron su historial (PDF y Excel) al menos una vez."
            />
            <Metric
              label="Lista de espera"
              value={m.waitlist.signups}
              sub={m.waitlist.signups === 1 ? 'registro' : 'registros'}
              how="Personas anotadas desde la landing, con consentimiento."
            />
          </Group>

          <Group title="Activación">
            <Metric
              label="Altas completas"
              value={percent(m.activation.onboardingComplete.rate)}
              sub={fraction(m.activation.onboardingComplete, 'que escribieron')}
              how="Usuarias con alta completa ÷ usuarias que escribieron."
            />
            <Metric
              label="PIN creado"
              value={percent(m.activation.pinCreated.rate)}
              sub={fraction(m.activation.pinCreated, 'altas completas')}
              how="Usuarias con PIN ÷ altas completas."
            />
            <Metric
              label="Uso semanal de la web"
              value={percent(m.web.weeklyUse.rate)}
              sub={fraction(m.web.weeklyUse, 'activas')}
              how={`Aproximado, últimos ${m.windows.recentDays} días: entró con PIN, usó el chat, descargó, canjeó o corrigió desde la web ÷ activas.`}
            />
          </Group>

          <Group title="Hábito">
            <Metric
              label="Cierres respondidos"
              value={percent(m.habit.closesReplied.rate)}
              sub={fraction(m.habit.closesReplied, 'cierres enviados')}
              how={`Días con respuesta ÷ días con mensaje de cierre (últimos ${m.windows.closesDays} días).`}
            />
            <Metric
              label="Racha media"
              value={decimal(m.habit.averageStreakDays)}
              sub={`días · ${plural(m.habit.usersWithStreak, 'usuaria', 'usuarias')} con racha`}
              how="Promedio de los días de racha actuales."
            />
            <Metric
              label="Tasa de captura (piloto)"
              value="—"
              sub="Se mide en el piloto"
              how="Filas de la lista ya registradas ÷ filas de la lista. Necesita las listas del piloto."
            />
          </Group>

          <Group title="Calidad y costo">
            <Metric
              label="Interpretación sin aclaración"
              value={percent(m.quality.withoutClarification.rate)}
              sub={fraction(m.quality.withoutClarification, 'respuestas')}
              how={`Respuestas al cierre sin WA-11 ÷ respuestas (últimos ${m.windows.closesDays} días).`}
            />
            <Metric
              label="Capturas ilegibles"
              value={percent(m.quality.unreadable.rate)}
              sub={fraction(m.quality.unreadable, 'capturas leídas')}
              how={`Capturas ilegibles ÷ capturas (últimos ${m.windows.closesDays} días).`}
            />
            <Metric
              label="Mensajes salientes por usuaria al día"
              value={decimal(m.cost.perUserPerDay, 2)}
              sub={`${m.cost.outbound} mensajes · ${m.cost.activeUserDays} días-usuaria`}
              how={`Mensajes salientes ÷ días con actividad de cada usuaria (últimos ${m.windows.recentDays} días).`}
            />
          </Group>

          <div className="grid grid-cols-[3fr_2fr] gap-4">
            <Panel title="Cierres completos por semana">
              <Table head={['Semana', 'Cierres completos', 'Usuarias activas', 'Promedio']}>
                {m.habit.completeClosesPerWeek.map((week) => (
                  <tr key={week.weekStart}>
                    <td className="whitespace-nowrap">Desde el {day(week.weekStart)}</td>
                    <td className="tabular-nums">{week.completeCloses}</td>
                    <td className="tabular-nums">{week.activeUsers}</td>
                    <td className="font-semibold tabular-nums">{decimal(week.average, 2)}</td>
                  </tr>
                ))}
              </Table>
              <p className="px-4 pb-3 text-xs text-muted">
                Últimas {m.windows.weeks} semanas completas (lunes a domingo), con el nivel final.
              </p>
            </Panel>
            <div className="flex flex-col gap-4">
              <Panel title="Canjes y reportes">
                <dl className="grid grid-cols-2 gap-y-2 px-4 py-3 text-sm">
                  <dt className="text-muted">Canjes aprobados</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {m.rewardsAndReports.redemptions.delivered}
                  </dd>
                  <dt className="text-muted">En revisión</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {m.rewardsAndReports.redemptions.in_review}
                  </dd>
                  <dt className="text-muted">Rechazados</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {m.rewardsAndReports.redemptions.rejected}
                  </dd>
                  <dt className="text-muted">Reportes descargados</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {m.rewardsAndReports.reports}
                  </dd>
                </dl>
              </Panel>
              <Panel title={`Salientes por tipo (${m.windows.recentDays} días)`}>
                {m.cost.byType.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">Sin mensajes salientes.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-y-1.5 px-4 py-3 text-sm">
                    {m.cost.byType.map((row) => (
                      <div key={row.type} className="contents">
                        <dt className="font-mono text-[13px]">{row.type}</dt>
                        <dd className="text-right font-semibold tabular-nums">{row.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Panel>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted">
            Usuaria activa: en el periodo escribió al menos un mensaje, tuvo un registro o recibió
            su mensaje de cierre. «Primer producto financiero» necesita la integración con el BCP y
            no se mide aquí.
          </p>
        </>
      )}
    </>
  );
}
