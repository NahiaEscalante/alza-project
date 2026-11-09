/**
 * Premios (RF-WP-05, 4.7, 13.2, 13.3, HU-12): the example catalog by milestone, redeeming with the
 * PIN (code DEMO-XXXX on screen, the balance and the bar go down) and the big goal apart, with the
 * active weeks it still needs or «en revisión».
 */
import { useState } from 'react';
import { CheckIcon, GiftIcon, LockIcon, RewardArt, StarBadge } from '../components/icons';
import { MilestoneBar } from '../components/milestone-bar';
import { Page } from '../components/shell';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FieldError,
  Loading,
  PageTitle,
  SectionTitle,
  Sheet,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatPoints, formatShortDate, plural } from '../lib/format';
import type { RedeemResponse, RewardItem, RewardsView } from '../lib/types';
import { useApi } from '../lib/use-api';
import { isPinCancelled, usePinGate } from '../state/pin';

const MILESTONES = [50, 100, 200, 400];

export function RewardsScreen() {
  const view = useApi<RewardsView>('/rewards');
  const [chosen, setChosen] = useState<{ reward: RewardItem; isBig: boolean } | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  return (
    <Page docTitle="Premios" wide>
      <PageTitle>Premios</PageTitle>
      {view.error ? (
        <ErrorState message={errorMessage(view.error)} onRetry={view.reload} />
      ) : !view.data ? (
        <Loading rows={4} tall />
      ) : (
        <RewardsContent
          view={view.data}
          onRedeem={(reward, isBig) => setChosen({ reward, isBig })}
          onHow={() => setHowOpen(true)}
        />
      )}
      <Sheet
        open={chosen !== null}
        onClose={() => {
          setChosen(null);
          view.reload();
        }}
        title="Canjear premio"
      >
        {chosen && view.data && (
          <RedeemBody
            reward={chosen.reward}
            isBig={chosen.isBig}
            balance={view.data.balance}
            onClose={() => {
              setChosen(null);
              view.reload();
            }}
          />
        )}
      </Sheet>
      <Sheet open={howOpen} onClose={() => setHowOpen(false)} title="Así funcionan tus puntos">
        <HowPointsWork onClose={() => setHowOpen(false)} />
      </Sheet>
    </Page>
  );
}

function RewardsContent({
  view,
  onRedeem,
  onHow,
}: {
  view: RewardsView;
  onRedeem: (reward: RewardItem, isBig: boolean) => void;
  onHow: () => void;
}) {
  const next = MILESTONES.find((m) => view.balance < m);
  const big = view.bigGoal;
  const bigReward = big.rewards[0];
  const bigPct = Math.min(100, (view.balance / big.costPoints) * 100);

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-x-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border-[#d5f0eb] bg-[#f3fbf9] lg:col-span-2 lg:p-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:items-center lg:gap-12">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] text-muted">Tus puntos</p>
              <p className="flex items-center gap-2 text-[40px] leading-tight font-bold text-navy tabular-nums">
                {formatPoints(view.balance)}
                <StarBadge className="size-10" />
              </p>
            </div>
            <button
              type="button"
              onClick={onHow}
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-[15px] font-semibold text-purple hover:bg-white"
            >
              Cómo funcionan
            </button>
          </div>
          <div>
            <div className="mt-3 lg:mt-0">
              <MilestoneBar balance={view.balance} milestones={MILESTONES} />
            </div>
            <p className="mt-2 text-[15px] text-text">
              {next
                ? `Te faltan ${formatPoints(next - view.balance)} para el hito de ${next}.`
                : 'Llegaste a todos los hitos.'}{' '}
              <span className="text-muted">Al canjear, tus puntos bajan.</span>
            </p>
          </div>
        </div>
      </Card>

      <div>
        {view.milestones.map((group) => (
          <section key={group.points} aria-labelledby={`hito-${group.points}`}>
            <SectionTitle
              action={
                group.reached ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok">
                    <CheckIcon className="size-4" />
                    Ya puedes canjear
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-muted">
                    Te faltan {formatPoints(group.points - view.balance)}
                  </span>
                )
              }
            >
              <span id={`hito-${group.points}`}>Hito {formatPoints(group.points)}</span>
            </SectionTitle>
            <ul className="flex flex-col gap-2.5 xl:grid xl:grid-cols-2 xl:gap-3">
              {group.rewards.map((reward) => (
                <RewardCard
                  key={reward.id}
                  reward={reward}
                  milestone={group.points}
                  balance={view.balance}
                  onRedeem={() => onRedeem(reward, false)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div>
        <section aria-labelledby="big-goal">
          <SectionTitle>
            <span id="big-goal">Meta grande</span>
          </SectionTitle>
          <Card>
            <div className="flex items-start gap-3.5">
              <RewardArt kind={big.costPoints} className="size-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{formatPoints(big.costPoints)} puntos</p>
                <p className="text-base font-semibold">{bigReward?.name ?? 'Premio grande'}</p>
                <p className="text-sm text-muted">
                  Requiere 8 semanas activas y pasa por revisión.
                </p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#d9deea]" aria-hidden="true">
              <div className="h-full rounded-full bg-navy" style={{ width: `${bigPct}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-[15px]">
              <dt className="text-muted">Puntos</dt>
              <dd className="font-semibold">
                {big.missingPoints > 0
                  ? `te faltan ${formatPoints(big.missingPoints)}`
                  : '¡Ya los tienes!'}
              </dd>
              <dt className="text-muted">Semanas activas</dt>
              <dd className="font-semibold">
                {big.activeWeeks} de {big.requiredActiveWeeks}
                {big.missingWeeks > 0 &&
                  ` · te ${plural(big.missingWeeks, 'falta', 'faltan')} ${big.missingWeeks}`}
              </dd>
            </dl>
            <p className="mt-2 text-sm text-muted">
              Una semana activa tiene al menos 3 cierres completos o a medias.
            </p>
            {bigReward?.canRedeem && (
              <Button className="mt-3" onClick={() => onRedeem(bigReward, true)}>
                Pedir canje · {formatPoints(bigReward.costPoints)} puntos
              </Button>
            )}
          </Card>
        </section>

        <section aria-labelledby="redemptions">
          <SectionTitle>
            <span id="redemptions">Tus canjes</span>
          </SectionTitle>
          {view.redemptions.length === 0 ? (
            <EmptyState icon={<GiftIcon />} title="Todavía no canjeas premios">
              Cuando llegues a un hito, canjea tu premio aquí.
            </EmptyState>
          ) : (
            <ul className="rounded-[14px] border border-border bg-card px-4">
              {view.redemptions.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{item.rewardName}</span>
                    <span className="block text-sm text-muted">
                      {formatShortDate(item.createdAt)} · {formatPoints(item.points)} puntos
                    </span>
                  </span>
                  {item.code ? (
                    <span className="shrink-0 font-bold text-navy">{item.code}</span>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold text-warn">
                      {item.statusText}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function RewardCard({
  reward,
  milestone,
  balance,
  onRedeem,
}: {
  reward: RewardItem;
  milestone: number;
  balance: number;
  onRedeem: () => void;
}) {
  const pct = Math.min(100, Math.round((balance / reward.costPoints) * 100));
  return (
    <li
      className={`rounded-[18px] border border-border p-4 xl:flex xl:flex-col ${reward.canRedeem ? 'bg-card' : 'bg-[#fafbfd]'}`}
    >
      {/* On a computer cards share a row: the action stays at the bottom of each. */}
      <div className="flex items-start gap-3.5 xl:mb-auto">
        <RewardArt
          kind={milestone}
          className={`size-14 shrink-0 ${reward.canRedeem ? '' : 'opacity-50'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{formatPoints(reward.costPoints)} puntos</p>
          <p className="text-base font-semibold">{reward.name}</p>
        </div>
      </div>
      {reward.canRedeem ? (
        <Button className="mt-3 min-h-12" onClick={onRedeem}>
          Canjear · {formatPoints(reward.costPoints)} puntos
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5 rounded-xl bg-[#eef2f8] px-3 py-2.5 text-sm font-semibold text-muted">
          <span className="flex items-center gap-1.5 text-text">
            <LockIcon className="size-4" />
            Te faltan {formatPoints(reward.missingPoints)} puntos
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-[#d9deea]" aria-hidden="true">
            <span className="block h-full rounded-full bg-navy" style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}
    </li>
  );
}

function RedeemBody({
  reward,
  isBig,
  balance,
  onClose,
}: {
  reward: RewardItem;
  isBig: boolean;
  balance: number;
  onClose: () => void;
}) {
  const withPin = usePinGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RedeemResponse | null>(null);

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      setDone(
        await withPin(() => api.post<RedeemResponse>('/redemptions', { rewardId: reward.id })),
      );
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const { redemption } = done;
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <span className="grid size-16 place-items-center rounded-full bg-[#e8f6f0] text-ok">
          <CheckIcon className="size-8" />
        </span>
        <p className="text-lg font-semibold">{redemption.rewardName}</p>
        {redemption.code ? (
          <div className="w-full rounded-[14px] border border-border bg-bg px-4 py-3">
            <p className="text-sm text-muted">Tu código</p>
            <p className="text-[28px] font-bold text-navy">{redemption.code}</p>
            <p className="text-sm text-muted">Código de ejemplo para la demo.</p>
          </div>
        ) : null}
        {!redemption.code && <p className="text-base">{done.message}</p>}
        <p className="text-base text-muted">
          Te {plural(done.balance, 'queda', 'quedan')}{' '}
          <b className="text-text">{formatPoints(done.balance)}</b>{' '}
          {plural(done.balance, 'punto', 'puntos')}.
        </p>
        <Button onClick={onClose}>Entendido</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <RewardArt kind={reward.costPoints} className="size-12 shrink-0" />
        <p className="text-lg font-semibold">{reward.name}</p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 rounded-[14px] bg-bg px-4 py-3 text-base">
        <dt className="text-muted">Cuesta</dt>
        <dd className="font-semibold">{formatPoints(reward.costPoints)} puntos</dd>
        <dt className="text-muted">Tienes</dt>
        <dd className="font-semibold">{formatPoints(balance)} puntos</dd>
        <dt className="text-muted">Te quedarán</dt>
        <dd className="font-bold text-navy">{formatPoints(balance - reward.costPoints)} puntos</dd>
      </dl>
      <p className="text-[15px] text-muted">
        {isBig
          ? 'Los premios grandes pasan por revisión del equipo. Cuando lo aprueben, verás tu código aquí.'
          : 'Te mostraremos tu código en esta pantalla y quedará guardado en «Tus canjes».'}{' '}
        Premio de ejemplo para la demo.
      </p>
      <FieldError>{error}</FieldError>
      <Button loading={busy} onClick={() => void redeem()}>
        Canjear con mi PIN
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onClose}>
        Ahora no
      </Button>
    </div>
  );
}

const POINT_RULES: [string, string][] = [
  ['Cierre completo', '10 puntos'],
  ['Cierre a medias', '4 puntos'],
  ['Cada 7 días seguidos', '+20 puntos'],
  ['Cada 30 días seguidos', '+50 puntos'],
  ['Semana con 5 cierres completos o más', '+15 puntos'],
  ['Tu primera racha de 7 días', '+30 puntos'],
];

function HowPointsWork({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">
        Ganas puntos por cerrar tu día en el chat de ALZA, no por cuánto vendes.
      </p>
      <dl className="rounded-[14px] border border-border px-4">
        {POINT_RULES.map(([what, points]) => (
          <div
            key={what}
            className="flex justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
          >
            <dt>{what}</dt>
            <dd className="shrink-0 font-semibold text-navy">{points}</dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2 text-[15px] text-muted">
        <li>
          <b className="text-text">Comodines:</b> tienes 2 por semana. Un día sin cierre no rompe tu
          racha, pero no suma puntos.
        </li>
        <li>
          <b className="text-text">Canjes:</b> al canjear un premio, tus puntos bajan.
        </li>
        <li>
          <b className="text-text">Vencen</b> si pasan 6 meses sin ningún cierre.
        </li>
      </ul>
      <Button onClick={onClose}>Entendido</Button>
    </div>
  );
}
