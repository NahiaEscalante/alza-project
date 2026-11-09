/**
 * Inicio (RF-WP-01, 12.2): points bar with milestones and what is missing for the next reward on
 * top; below, entró / salió / te quedó of the week, the chart by day and the pending notice.
 *
 * On a computer (D79): the week and the chart on the left; the pending notice, points and streak
 * in a column on the right. The wrappers are `display: contents` on a phone, where `order` keeps
 * the phone sequence.
 */
import { Link } from 'wouter';
import {
  AlertIcon,
  ChevronRightIcon,
  FlameBadge,
  ShieldBadge,
  StarBadge,
} from '../components/icons';
import { MilestoneBar } from '../components/milestone-bar';
import { Money } from '../components/money';
import { Page } from '../components/shell';
import { Card, ErrorState, Loading } from '../components/ui';
import { WeekChart } from '../components/week-chart';
import { errorMessage } from '../lib/api';
import { formatPoints, pendingNotice, plural } from '../lib/format';
import type { CounterpartyRulesResponse, HomeResponse, PointsSummary } from '../lib/types';
import { useApi } from '../lib/use-api';

export function HomeScreen() {
  const home = useApi<HomeResponse>('/home');
  const rules = useApi<CounterpartyRulesResponse>('/counterparty-rules');

  return (
    <Page docTitle="Inicio" wide>
      <h1 className="sr-only">Inicio</h1>
      {home.error ? (
        <ErrorState message={errorMessage(home.error)} onRetry={home.reload} />
      ) : !home.data ? (
        <Loading rows={4} tall />
      ) : (
        <HomeContent
          home={home.data}
          pendingCount={home.data.pending.count + (rules.data?.offers.length ?? 0)}
        />
      )}
    </Page>
  );
}

function HomeContent({ home, pendingCount }: { home: HomeResponse; pendingCount: number }) {
  const { points, week } = home;
  const notice = pendingNotice(pendingCount);
  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="contents lg:flex lg:flex-col lg:gap-6">
        <section aria-labelledby="week-title" className="order-3 mt-2 lg:order-none lg:mt-0">
          <div className="mx-1 mb-2.5 flex items-baseline justify-between gap-3 lg:mx-0 lg:mb-3">
            <h2 id="week-title" className="text-base font-semibold lg:text-lg">
              Esta semana
            </h2>
            <span className="text-sm text-muted">{week.label}</span>
          </div>
          <div className="xl:grid xl:grid-cols-3 xl:gap-4">
            <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#7b3ff2_0%,#4b1bb8_60%,#3a1296_100%)] p-[18px] text-white shadow-[0_14px_28px_-14px_rgba(58,18,150,0.6)] lg:p-5">
              <p className="text-base font-medium">Entró</p>
              <p className="mt-1 mb-2 text-[38px] leading-tight font-bold lg:text-[34px]">
                <Money cents={week.inCents} />
              </p>
              <p className="text-sm text-white/90">
                Yape y Plin <Money cents={week.digitalSalesCents} /> · Efectivo{' '}
                <Money cents={week.cashSalesCents} />
              </p>
              {week.completeCount + week.partialCount > 0 && (
                <span className="mt-3 inline-block rounded-full bg-mint px-2.5 py-1 text-sm font-semibold text-text">
                  {week.completeCount}{' '}
                  {plural(week.completeCount, 'cierre completo', 'cierres completos')}
                  {week.partialCount > 0 && ` · ${week.partialCount} a medias`}
                </span>
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:mt-4 lg:gap-4 xl:col-span-2 xl:mt-0">
              <div className="flex flex-col gap-1 rounded-[18px] bg-lav-soft p-3.5 lg:p-5">
                <span className="text-sm font-medium text-muted lg:text-base">Salió</span>
                <b className="text-xl font-bold lg:text-[28px] lg:leading-tight">
                  <Money cents={week.outCents} />
                </b>
                <small className="text-sm leading-snug text-muted">Mercadería, gastos y casa</small>
              </div>
              <div className="flex flex-col gap-1 rounded-[18px] bg-blue-soft p-3.5 lg:p-5">
                <span className="text-sm font-medium text-muted lg:text-base">Te quedó</span>
                <b className="text-xl font-bold lg:text-[28px] lg:leading-tight">
                  <Money cents={week.leftCents} />
                </b>
                <small className="text-sm leading-snug text-muted">Entró menos salió</small>
              </div>
            </div>
          </div>
          {week.pendingCents > 0 && (
            <p className="mx-1 mt-2 text-sm text-muted lg:mx-0">
              Por confirmar: <Money cents={week.pendingCents} /> (todavía no suma).
            </p>
          )}
        </section>

        <Card as="section" className="order-4 mt-1 lg:order-none lg:mt-0 lg:p-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold lg:text-lg">Lo que entró cada día</h2>
            <span className="text-sm text-muted">
              <span className="lg:hidden">Toca un día</span>
              <span className="hidden lg:inline">Elige un día</span>
            </span>
          </div>
          <WeekChart days={week.days} />
        </Card>
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {notice && (
          <Link
            href="/pendientes"
            className="order-5 flex min-h-13 items-center gap-2.5 rounded-[14px] border border-[#f2c894] bg-[#fdf3e7] px-4 text-base font-bold text-[#8a3f06] lg:order-none"
          >
            <AlertIcon className="size-5 shrink-0" />
            <span className="flex-1">{notice}</span>
            <ChevronRightIcon className="size-5 shrink-0" />
          </Link>
        )}
        <div className="order-1 lg:order-none">
          <PointsCard points={points} />
        </div>
        <div className="order-2 lg:order-none">
          <StreakStrip days={points.streakDays} freezes={points.freezesLeft} />
        </div>
      </div>
    </div>
  );
}

function PointsCard({ points }: { points: PointsSummary }) {
  const bigPct = Math.min(100, (points.balance / points.bigGoal) * 100);
  return (
    <section
      aria-labelledby="points-title"
      className="rounded-[18px] border border-[#d5f0eb] bg-[#f3fbf9] px-4 pt-3 pb-3.5"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white">
          <StarBadge className="size-8" />
        </span>
        <h2 id="points-title" className="flex flex-1 items-baseline gap-1.5">
          <b className="text-[28px] leading-none font-bold text-navy tabular-nums">
            {formatPoints(points.balance)}
          </b>
          <span className="text-[15px] font-semibold text-muted">puntos</span>
        </h2>
        <Link
          href="/premios"
          className="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-[15px] font-bold text-navy hover:bg-white"
        >
          Premios
          <ChevronRightIcon className="size-4" />
        </Link>
      </div>
      <div className="mt-3">
        <MilestoneBar balance={points.balance} milestones={points.milestones} />
      </div>
      <p className="mt-2 text-[15px] text-text">
        {points.nextReward ? (
          <>
            Te faltan{' '}
            <b className="font-bold text-navy">{formatPoints(points.nextReward.missingPoints)}</b>{' '}
            para: <b className="font-semibold">{points.nextReward.name}</b>
          </>
        ) : (
          <>Llegaste a todos los hitos. ¡Mira qué puedes canjear!</>
        )}
      </p>
      <div className="mt-3 border-t border-[#d5f0eb] pt-2.5">
        <p className="flex justify-between gap-2 text-sm text-muted">
          <span>Meta grande · {formatPoints(points.bigGoal)} puntos</span>
          <span className="font-semibold text-text">
            {points.missingForBigGoal > 0
              ? `te faltan ${formatPoints(points.missingForBigGoal)}`
              : '¡Llegaste!'}
          </span>
        </p>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-[#d5e9e5]"
          aria-hidden="true"
        >
          <div className="h-full rounded-full bg-mint" style={{ width: `${bigPct}%` }} />
        </div>
      </div>
    </section>
  );
}

function StreakStrip({ days, freezes }: { days: number; freezes: number }) {
  return (
    <div className="flex min-h-13 items-center gap-2.5 rounded-[14px] border border-[#fcd9a8] bg-white px-3 py-2">
      <FlameBadge className="size-7 shrink-0" />
      <p className="flex-1 text-base">
        {days > 0 ? (
          <>
            <b className="text-lg font-bold text-warn">{days}</b>{' '}
            {plural(days, 'día seguido', 'días seguidos')} cerrando tu día
          </>
        ) : (
          'Cierra tu día hoy para empezar tu racha'
        )}
      </p>
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-3 py-1.5 text-[15px] font-bold text-navy">
        <ShieldBadge />
        {freezes}
        <span className="sr-only"> {plural(freezes, 'comodín', 'comodines')} esta semana</span>
      </span>
    </div>
  );
}
