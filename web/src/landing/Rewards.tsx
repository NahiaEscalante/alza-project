import { PointsStar, RewardArt, type RewardKind } from './icons';
import { Eyebrow, groupThousands, Section } from './ui';

/** «Premios por constancia» (13.1, 13.2). Without the example-catalog notes on the landing (D75). */

const EARN = [
  { label: 'Cierre completo', points: 10 },
  { label: 'Cierre a medias', points: 4 },
  { label: 'Cada 7 días seguidos', points: 20 },
  { label: 'Semana con 5 cierres completos', points: 15 },
  { label: 'Tu primera racha de 7 días', points: 30 },
];

const REWARDS: Array<{ points: number; name: string; time: string; art: RewardKind }> = [
  {
    points: 50,
    name: 'Descuento en app de comida o transporte',
    time: 'Menos de 1 semana',
    art: 'app',
  },
  {
    points: 100,
    name: 'Útiles escolares o artículos de limpieza',
    time: '1 a 2 semanas',
    art: 'school',
  },
  { points: 200, name: 'Descuento en proveedor', time: '2 a 3 semanas', art: 'supplier' },
  {
    points: 400,
    name: 'Descuento mayor en proveedor o kit escolar completo',
    time: 'Alrededor de 1 mes',
    art: 'kit',
  },
];

export function Rewards() {
  return (
    <Section id="premios" labelledBy="premios-title">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,400px)_1fr] lg:gap-16">
        <div>
          <Eyebrow>Premios por constancia</Eyebrow>
          <h2
            id="premios-title"
            className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
          >
            Ser constante tiene premio
          </h2>
          <p className="mt-4 text-lg text-muted">
            Cada día que cierras tu caja sumas puntos. Al llegar a cada meta, canjeas un premio.
          </p>

          <div className="mt-8 rounded-[24px] border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold text-text">
              <PointsStar className="size-8" />
              Así sumas puntos
            </h3>
            <dl className="mt-3 divide-y divide-border">
              {EARN.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="shrink-0 rounded-full bg-lav-soft px-2.5 py-0.5 text-[15px] font-bold tabular-nums text-purple">
                    +{row.points}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 rounded-xl bg-blue-soft px-4 py-3 text-[15px] text-text">
              <b>2 comodines por semana:</b> un día libre no rompe tu racha.
            </p>
          </div>
          <p className="mt-4 text-[15px] text-muted">
            Si cierras casi todos los días, sumas unos 90 puntos por semana.
          </p>
        </div>

        <div>
          <h3 className="text-xl font-bold text-text">Premios por meta</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {REWARDS.map((r) => (
              <li
                key={r.points}
                className="flex gap-4 rounded-[20px] border border-border bg-card p-4 transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(14,42,139,0.45)]"
              >
                <RewardArt kind={r.art} className="size-14 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular-nums text-purple">{r.points} puntos</p>
                  <p className="mt-0.5 font-semibold leading-snug text-text">{r.name}</p>
                  <p className="mt-1 text-sm text-muted">{r.time}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-4 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#7b3ff2] via-[#4b1bb8] to-[#3a1296] p-5 text-white shadow-[0_14px_28px_-14px_rgba(58,18,150,0.6)]">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/95">
              <RewardArt kind="appliance" className="size-12" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-wide text-[#c9b6ff]">
                META GRANDE · {groupThousands(2500)} PUNTOS
              </p>
              <p className="mt-0.5 text-lg font-bold">Electrodoméstico</p>
              <p className="text-[15px] text-white/85">
                Alrededor de 6 meses. Pide 8 semanas activas y el equipo lo revisa.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
