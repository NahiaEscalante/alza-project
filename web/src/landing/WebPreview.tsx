import { useRef } from 'react';
import { useInView } from './hooks';
import {
  AlertIcon,
  ChartIcon,
  CheckIcon,
  HistoryIcon,
  PointsStar,
  SearchCheckIcon,
  ShieldIcon,
} from './icons';
import { ExampleTag, Eyebrow, groupThousands, Section, soles } from './ui';

/**
 * «Lo que ves en la web» (12.2 Inicio, 13.2): points bar with milestones and the week card.
 * Sample data, labeled as such (3.2). Week numbers match the 12.2 wireframe.
 */

const MILESTONES = [50, 100, 200, 400] as const;
const SAMPLE_POINTS = 340;
const BIG_GOAL = 2500;
/** Entró per day, Monday to Saturday (sums to S/ 2 140); Sunday has not happened yet. */
const WEEK = [
  { day: 'L', label: 'lunes', value: 210 },
  { day: 'M', label: 'martes', value: 395 },
  { day: 'X', label: 'miércoles', value: 275 },
  { day: 'J', label: 'jueves', value: 480 },
  { day: 'V', label: 'viernes', value: 430 },
  { day: 'S', label: 'sábado', value: 350 },
  { day: 'D', label: 'domingo', value: null },
] as const;
const TODAY = 'S';

const FEATURES = [
  {
    icon: SearchCheckIcon,
    title: 'Sabes de dónde sale cada monto',
    text: '«Con captura» si lo leímos de tu Yape o Plin. «Lo contaste tú» si nos lo dijiste.',
  },
  {
    icon: HistoryIcon,
    title: 'Corriges sin perder nada',
    text: 'Si algo está mal, lo cambias. El cambio queda anotado, no se borra a escondidas.',
  },
  {
    icon: ChartIcon,
    title: 'Tu historial, listo para crecer',
    text: 'Descárgalo cuando quieras y muéstralo si buscas un préstamo o un proveedor nuevo.',
  },
  {
    icon: ShieldIcon,
    title: 'Oculta tus montos con un toque',
    text: 'Si alguien mira tu pantalla, tus números no se ven.',
  },
];

export function WebPreview() {
  return (
    <Section id="web" labelledBy="web-title" className="bg-white">
      <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start lg:pt-6">
          <Eyebrow>En la web, con tu PIN</Eyebrow>
          <h2
            id="web-title"
            className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
          >
            Tu negocio en números simples
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Entra con el enlace que te manda ALZA y mira tu semana: cuánto entró, cuánto salió y
            cuánto te quedó. Sin palabras raras.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lav-soft text-purple">
                  <Icon className="size-[22px]" />
                </span>
                <span>
                  <b className="block font-semibold text-text">{title}</b>
                  <span className="text-[15px] leading-snug text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative rounded-[28px] bg-bg p-3 ring-1 ring-border sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-[15px] font-semibold text-text">Hola, Marta · Bodega Sol</span>
            <ExampleTag />
          </div>
          <PointsCard />
          <WeekCard />
          <p className="mt-3 flex min-h-12 items-center gap-2 rounded-2xl border border-[#f2c894] bg-[#fdf3e7] px-4 font-semibold text-warn">
            <AlertIcon className="size-5 shrink-0" />
            Tienes 2 cosas por revisar
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Where a points balance sits on the bar: milestones are evenly spaced (13.2, 12.2). */
function barPosition(points: number): number {
  let prev = 0;
  for (const [i, m] of MILESTONES.entries()) {
    if (points < m) return ((i + (points - prev) / (m - prev)) / MILESTONES.length) * 100;
    prev = m;
  }
  return 100;
}

function PointsCard() {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useInView(ref, { once: true, rootMargin: '-15% 0px' });
  const next = MILESTONES.find((m) => m > SAMPLE_POINTS);
  const missing = next ? next - SAMPLE_POINTS : 0;

  return (
    <div ref={ref} className="rounded-[20px] border border-[#d5f0eb] bg-[#f3fbf9] p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-white">
          <PointsStar className="size-9" />
        </span>
        <p className="flex items-baseline gap-1.5">
          <b className="text-[32px] font-bold leading-none tabular-nums text-navy">
            {SAMPLE_POINTS}
          </b>
          <span className="font-semibold text-muted">puntos</span>
        </p>
      </div>

      <div className="relative mt-6 mb-2 px-[11px]">
        <div className="h-2 rounded-full bg-white ring-1 ring-[#d5f0eb]">
          <div
            className="lp-fill h-full rounded-full bg-navy"
            style={{ width: shown ? `${barPosition(SAMPLE_POINTS)}%` : '0%' }}
          />
        </div>
        <ol className="absolute inset-x-[11px] -top-[7px]">
          {MILESTONES.map((m, i) => {
            const reached = SAMPLE_POINTS >= m;
            const isNext = m === next;
            return (
              <li
                key={m}
                className="absolute -translate-x-1/2"
                style={{ left: `${((i + 1) / MILESTONES.length) * 100}%` }}
              >
                <span
                  className={`grid size-[22px] place-items-center rounded-full border-2 ${
                    reached
                      ? 'border-navy bg-navy text-white'
                      : isNext
                        ? 'border-purple bg-white'
                        : 'border-[#b6bfd3] bg-white'
                  }`}
                >
                  {reached && <CheckIcon className="size-3.5 stroke-[3]" />}
                  <span className="sr-only">
                    {m} puntos: {reached ? 'alcanzado' : 'por alcanzar'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="relative h-6 px-[11px] text-sm font-semibold" aria-hidden="true">
        {MILESTONES.map((m, i) => (
          <li
            key={m}
            className={`absolute -translate-x-1/2 ${SAMPLE_POINTS >= m ? 'text-navy' : m === next ? 'text-purple' : 'text-muted'}`}
            style={{ left: `calc(11px + (100% - 22px) * ${(i + 1) / MILESTONES.length})` }}
          >
            {m}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[15px] text-muted">
        Te faltan <b className="text-purple tabular-nums">{missing}</b> para:
        <b className="block text-text">Descuento mayor en proveedor o kit escolar completo</b>
      </p>
      <div className="mt-3 rounded-xl bg-white px-3 py-2.5 text-sm text-muted">
        <p>
          Meta grande: <b className="text-text">electrodoméstico</b>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e8f1]">
          <div
            className="lp-fill h-full rounded-full bg-purple"
            style={{ width: shown ? `${(SAMPLE_POINTS / BIG_GOAL) * 100}%` : '0%' }}
          />
        </div>
        <p className="mt-1.5 flex justify-between gap-2 tabular-nums">
          <span>
            {SAMPLE_POINTS} de {groupThousands(BIG_GOAL)}
          </span>
          <span>te faltan {groupThousands(BIG_GOAL - SAMPLE_POINTS)}</span>
        </p>
      </div>
    </div>
  );
}

function WeekCard() {
  const max = Math.max(...WEEK.map((d) => d.value ?? 0));
  const rows = [
    { label: 'Entró', value: '2 140' },
    { label: 'Salió', value: '1 310' },
  ];
  return (
    <div className="mt-3 rounded-[20px] border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-text">Esta semana</h3>
        <span className="text-sm text-muted">lun 9 – dom 15 nov</span>
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 tabular-nums">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted">{r.label}</dt>
            <dd className="text-right font-semibold">{soles(r.value)}</dd>
          </div>
        ))}
        <dt className="mt-1 border-t border-border pt-2 font-semibold text-text">Te quedó</dt>
        <dd className="mt-1 border-t border-border pt-2 text-right text-xl font-bold text-navy">
          {soles('830')}
        </dd>
      </dl>
      <figure className="mt-4">
        <div className="grid h-24 grid-cols-7 items-end gap-1.5">
          {WEEK.map((d) => (
            <div key={d.day} className="relative flex h-full flex-col justify-end">
              {d.value === null ? (
                <span className="block h-3 rounded-t-md border-2 border-dashed border-[#cdd3e1] border-b-0" />
              ) : (
                <span
                  className={`block rounded-t-md ${d.day === TODAY ? 'bg-purple' : 'bg-lav'}`}
                  style={{ height: `${(d.value / max) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5 text-center text-sm text-muted">
          {WEEK.map((d) => (
            <span key={d.day} className={d.day === TODAY ? 'font-bold text-text' : undefined}>
              {d.day}
            </span>
          ))}
        </div>
        <figcaption className="sr-only">
          Lo que entró cada día:{' '}
          {WEEK.map(
            (d) => `${d.label} ${d.value === null ? 'sin datos aún' : soles(String(d.value))}`,
          ).join(', ')}
          .
        </figcaption>
      </figure>
    </div>
  );
}
