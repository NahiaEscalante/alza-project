/**
 * One day (12.2 «Dentro de un día»): totals, level, and each record with its tag. «+ Agregar algo
 * que faltó» only on past days (D16).
 */
import { Link } from 'wouter';
import { EntryRow } from '../components/entry-row';
import { AlertIcon, ChevronRightIcon, ListIcon, PlusIcon } from '../components/icons';
import { Money } from '../components/money';
import { Page } from '../components/shell';
import { LevelBadge, Tag } from '../components/tags';
import { Totals } from '../components/totals';
import { buttonClass, Card, EmptyState, ErrorState, Loading, SectionTitle } from '../components/ui';
import { errorMessage } from '../lib/api';
import { capitalize, dayLabel, longDayLabel, plural } from '../lib/format';
import type { DayEntriesResponse } from '../lib/types';
import { useApi } from '../lib/use-api';
import { movementsHref } from './movements';

export function DayScreen({ date }: { date: string }) {
  const result = useApi<DayEntriesResponse>(`/days/${date}/entries`);
  const data = result.data;

  return (
    <Page title={capitalize(dayLabel(date))} back={movementsHref(date)}>
      {result.error ? (
        <ErrorState message={errorMessage(result.error)} onRetry={result.reload} />
      ) : !data ? (
        <Loading rows={4} tall />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-base font-semibold">
                {data.day.isToday ? 'Hoy' : capitalize(longDayLabel(date))}
              </p>
              <LevelBadge
                level={data.day.level}
                text={data.day.levelText}
                isToday={data.day.isToday}
              />
            </div>
            <div className="mt-2">
              <Totals
                inCents={data.day.inCents}
                outCents={data.day.outCents}
                leftCents={data.day.leftCents}
              />
            </div>
            {(data.day.pendingCents > 0 || data.day.cashUnreviewed) && (
              <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                {data.day.pendingCents > 0 && (
                  <p className="text-sm text-muted">
                    Por confirmar: <Money cents={data.day.pendingCents} /> (todavía no suma)
                  </p>
                )}
                {data.day.cashUnreviewed && (
                  <p className="flex flex-col gap-0.5">
                    <Tag tone="warn">Caja sin revisar</Tag>
                    <span className="text-sm text-muted">
                      No confirmaste si tu efectivo cuadra ese día.
                    </span>
                  </p>
                )}
              </div>
            )}
          </Card>

          {data.day.pendingCount > 0 && (
            <Link
              href="/pendientes"
              className="mt-3 flex min-h-13 items-center gap-2.5 rounded-[14px] border border-[#f2c894] bg-[#fdf3e7] px-4 text-base font-semibold text-[#8a3f06]"
            >
              <AlertIcon className="size-5 shrink-0" />
              <span className="flex-1">
                Este día tiene {data.day.pendingCount}{' '}
                {plural(data.day.pendingCount, 'cosa por revisar', 'cosas por revisar')}
              </span>
              <ChevronRightIcon className="size-5 shrink-0" />
            </Link>
          )}

          <SectionTitle>
            {data.entries.length > 0
              ? `${data.entries.length} ${plural(data.entries.length, 'registro', 'registros')}`
              : 'Registros'}
          </SectionTitle>
          {data.entries.length === 0 ? (
            <EmptyState icon={<ListIcon />} title="No hay registros este día">
              {data.canAddEntries
                ? 'Si te faltó anotar algo, agrégalo aquí.'
                : 'Manda tus capturas y ventas por el chat de ALZA y aparecerán aquí.'}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} href={`/movimientos/${date}/${entry.id}`} />
              ))}
            </ul>
          )}

          {data.canAddEntries && (
            <Link
              href={`/movimientos/${date}/agregar`}
              className={`${buttonClass('secondary')} mt-4`}
            >
              <PlusIcon className="size-5" />
              Agregar algo que faltó
            </Link>
          )}

          <TagLegend />
        </>
      )}
    </Page>
  );
}

/** «Qué quiere decir cada etiqueta» (Anexo A). */
export function TagLegend() {
  return (
    <details className="mt-5 rounded-[14px] border border-border bg-card px-4 py-1 text-[15px]">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text">
        Qué quiere decir cada etiqueta
      </summary>
      <ul className="flex flex-col gap-2.5 pb-3 text-muted">
        <li>
          <Tag tone="ok">Con captura</Tag> Lo sabemos por tu captura de Yape o Plin.
        </li>
        <li>
          <Tag tone="self">Lo contaste tú</Tag> Lo sabemos porque nos lo dijiste o lo cambiaste tú.
        </li>
        <li>
          <Tag tone="warn">Por confirmar</Tag> Tenemos una duda; todavía no lo sumamos.
        </li>
        <li>
          <Tag tone="warn">Caja sin revisar</Tag> No confirmaste si tu efectivo cuadra.
        </li>
      </ul>
    </details>
  );
}
