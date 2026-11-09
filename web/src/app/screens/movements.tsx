/**
 * Movimientos (RF-WP-02, 12.2): one week at a time, most recent day first, each with its close
 * level («completo», «a medias», «sin cierre») and «Caja sin revisar»; and the button to download
 * her history (Fase 8).
 *
 * On a computer (D79): the days on the left, with the amounts in columns; the week picker, the
 * totals and the download on a sticky column on the right.
 */
import { Link, useSearchParams } from 'wouter';
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListIcon,
} from '../components/icons';
import { Money } from '../components/money';
import { Page } from '../components/shell';
import { LevelBadge, Tag } from '../components/tags';
import { Totals, TotalsLine } from '../components/totals';
import { buttonClass, Card, EmptyState, ErrorState, Loading, PageTitle } from '../components/ui';
import { errorMessage } from '../lib/api';
import {
  addDays,
  capitalize,
  isIsoDate,
  plural,
  todayBusinessDay,
  weekLabel,
  weekStart,
} from '../lib/format';
import type { DaysResponse, DayView } from '../lib/types';
import { useApi } from '../lib/use-api';

/** Oldest week she can browse back to (about a year). */
const MAX_WEEKS_BACK = 52;

/** Movimientos at the week of `day` (the current week has no parameter). */
export function movementsHref(day: string): string {
  const monday = weekStart(day);
  return monday === weekStart(todayBusinessDay())
    ? '/movimientos'
    : `/movimientos?semana=${monday}`;
}

export function MovementsScreen() {
  const [params, setParams] = useSearchParams();
  const currentMonday = weekStart(todayBusinessDay());
  const oldest = addDays(currentMonday, -7 * MAX_WEEKS_BACK);
  const requested = params.get('semana') ?? '';
  const monday =
    isIsoDate(requested) &&
    weekStart(requested) === requested &&
    requested <= currentMonday &&
    requested >= oldest
      ? requested
      : currentMonday;
  const days = useApi<DaysResponse>(`/days?from=${monday}&to=${addDays(monday, 6)}`);

  const goToWeek = (target: string) =>
    setParams(target === currentMonday ? {} : { semana: target }, { replace: true });

  const list = days.data?.days ?? [];
  const inCents = list.reduce((sum, day) => sum + day.inCents, 0);
  const outCents = list.reduce((sum, day) => sum + day.outCents, 0);
  const leftCents = list.reduce((sum, day) => sum + day.leftCents, 0);

  const hasActivity = Boolean(days.data && list.some((day) => day.hasActivity));

  return (
    <Page docTitle="Movimientos" wide>
      <PageTitle>Movimientos</PageTitle>
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-4">
          <nav
            aria-label="Semanas"
            className="order-1 mb-3 flex items-center justify-between gap-1 rounded-[18px] border border-border bg-card p-1.5 lg:order-none lg:mb-0"
          >
            <button
              type="button"
              onClick={() => goToWeek(addDays(monday, -7))}
              disabled={monday <= oldest}
              aria-label="Semana anterior"
              className="grid size-11 place-items-center rounded-xl text-navy hover:bg-bg disabled:opacity-40"
            >
              <ChevronLeftIcon />
            </button>
            <div className="min-w-0 text-center" aria-live="polite">
              <p className="truncate text-base font-bold text-navy">
                {monday === currentMonday ? 'Esta semana' : (days.data?.label ?? weekLabel(monday))}
              </p>
              {monday === currentMonday && (
                <p className="text-sm text-muted">{weekLabel(monday)}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => goToWeek(addDays(monday, 7))}
              disabled={monday >= currentMonday}
              aria-label="Semana siguiente"
              className="grid size-11 place-items-center rounded-xl text-navy hover:bg-bg disabled:opacity-40"
            >
              <ChevronRightIcon />
            </button>
          </nav>

          {hasActivity && (
            <>
              <div className="order-2 mx-1 mb-3 lg:hidden">
                <TotalsLine inCents={inCents} outCents={outCents} leftCents={leftCents} />
              </div>
              <Card className="hidden lg:block lg:p-5">
                <h2 className="mb-1 text-base font-semibold">Total de la semana</h2>
                <Totals inCents={inCents} outCents={outCents} leftCents={leftCents} />
              </Card>
            </>
          )}

          <Link
            href="/descargar"
            className={`${buttonClass('secondary')} order-4 mt-5 lg:order-none lg:mt-0`}
          >
            <DownloadIcon className="size-5" />
            Descargar mi historial
          </Link>
        </div>

        <div className="order-3 lg:order-none lg:col-start-1 lg:row-start-1">
          {days.error ? (
            <ErrorState message={errorMessage(days.error)} onRetry={days.reload} />
          ) : !days.data ? (
            <Loading rows={5} />
          ) : !hasActivity ? (
            <EmptyState icon={<ListIcon />} title="No hay movimientos en esta semana">
              Lo que mandes por el chat de ALZA aparecerá aquí, día por día.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((day) => (
                <DayRow key={day.businessDay} day={day} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  );
}

function DayRow({ day }: { day: DayView }) {
  const warnings = (day.cashUnreviewed || day.pendingCount > 0) && (
    <span className="mt-1 flex flex-wrap gap-x-3">
      {day.cashUnreviewed && <Tag tone="warn">Caja sin revisar</Tag>}
      {day.pendingCount > 0 && (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warn">
          <AlertIcon className="size-3.5" />
          {day.pendingCount} {plural(day.pendingCount, 'cosa por revisar', 'cosas por revisar')}
        </span>
      )}
    </span>
  );
  return (
    <li>
      <Link
        href={`/movimientos/${day.businessDay}`}
        className="flex min-h-16 items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 hover:border-[#cfd6e6] xl:px-5"
      >
        {/* Phone and small computer: name and level on top, amounts below. */}
        <span className="min-w-0 flex-1 xl:hidden">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <b className="text-base font-semibold">{day.isToday ? 'Hoy' : capitalize(day.label)}</b>
            <LevelBadge level={day.level} text={day.levelText} isToday={day.isToday} />
          </span>
          {day.hasActivity ? (
            <span className="mt-0.5 block text-[15px] text-muted">
              Entró <Money cents={day.inCents} className="text-text" /> · Salió{' '}
              <Money cents={day.outCents} className="text-text" />
            </span>
          ) : (
            <span className="mt-0.5 block text-[15px] text-muted">Sin movimientos</span>
          )}
          {warnings}
        </span>
        {/* Wide computer (xl): one row with columns. */}
        <span className="hidden min-w-0 flex-1 items-center gap-4 xl:grid xl:grid-cols-[minmax(0,1.4fr)_1fr_1fr_minmax(0,1.1fr)]">
          <span className="min-w-0">
            <b className="block text-base font-semibold">
              {day.isToday ? 'Hoy' : capitalize(day.label)}
            </b>
            {warnings}
          </span>
          {day.hasActivity ? (
            <>
              <span className="text-[15px]">
                <span className="block text-sm text-muted">Entró</span>
                <Money cents={day.inCents} className="font-semibold text-text" />
              </span>
              <span className="text-[15px]">
                <span className="block text-sm text-muted">Salió</span>
                <Money cents={day.outCents} className="font-semibold text-text" />
              </span>
            </>
          ) : (
            <span className="col-span-2 text-[15px] text-muted">Sin movimientos</span>
          )}
          <span className="flex justify-end">
            <LevelBadge level={day.level} text={day.levelText} isToday={day.isToday} />
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}
