import { AlertIcon } from './icons';
import { Eyebrow, Section } from './ui';

/**
 * «Proyecto del Reto 2 · Hackathon CIX» (D43, D44): CIX featured, then UTEC Ventures and
 * Credicorp, with the disclaimer. Problem figures from spec 1.1 (Reto 2 document).
 *
 * No public CIX logo file was found (web/public/logos/SOURCES.md): its name is set as text.
 * When the team gets the official file, save it in web/public/logos and set the path here.
 */
const CIX_LOGO_SRC: string | null = null;

const FIGURES = [
  {
    value: '75,3 %',
    text: 'de las mypes no lleva ningún registro de cuentas.',
    source: 'SBS, citado por Andina, 2022',
  },
  {
    value: '15 %',
    text: 'de las emprendedoras alcanza una salud financiera óptima.',
    source: 'CARE Perú, 2025',
  },
  {
    value: '29 %',
    text: 'menos crédito reciben las mujeres, aunque se atrasan menos en sus pagos.',
    source: 'MEF, 2026',
  },
];

export function Hackathon() {
  return (
    <Section id="reto" labelledBy="reto-title" className="bg-white">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,480px)] lg:gap-16">
        <div>
          <Eyebrow>Proyecto del Reto 2 · Hackathon CIX</Eyebrow>
          <h2
            id="reto-title"
            className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
          >
            Nació para que más emprendedoras puedan demostrar cómo les va
          </h2>
          <p className="mt-4 text-lg text-muted">
            Creamos ALZA para el Reto 2, «Crecimiento financiero para emprendedoras». Sin registros,
            se decide por intuición, y cuando quieres crecer no tienes cómo mostrar tu negocio.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-[24px] border border-border bg-card p-6 shadow-[0_20px_40px_-28px_rgba(14,42,139,0.35)]">
            <p className="text-sm font-semibold text-muted">Hackathon de</p>
            {CIX_LOGO_SRC ? (
              <img
                src={CIX_LOGO_SRC}
                alt="CIX, Centro de InnovaCXión del BCP"
                className="mt-3 h-16 w-auto"
              />
            ) : (
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[64px] font-black leading-none tracking-[-0.04em] text-navy">
                  CIX
                </span>
                <span className="text-[15px] font-semibold leading-snug text-muted">
                  Centro de InnovaCXión
                  <br />
                  del BCP
                </span>
              </p>
            )}
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-semibold text-muted">Con</p>
              <ul className="mt-3 grid grid-cols-2 items-center gap-4">
                <li className="flex h-16 items-center justify-center rounded-2xl bg-bg px-4">
                  <img
                    src="/logos/utec-ventures.png"
                    alt="UTEC Ventures"
                    width={381}
                    height={120}
                    loading="lazy"
                    className="h-10 w-auto max-w-full object-contain"
                  />
                </li>
                <li className="flex h-16 items-center justify-center rounded-2xl bg-bg px-4">
                  <img
                    src="/logos/credicorp.svg"
                    alt="Credicorp"
                    width={336}
                    height={40}
                    loading="lazy"
                    className="h-[18px] w-auto max-w-full object-contain sm:h-5"
                  />
                </li>
              </ul>
            </div>
          </div>

          <p className="flex gap-3 rounded-2xl border border-border bg-bg p-4 text-[15px] text-text">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-navy" />
            <span>
              ALZA es un proyecto creado para el Reto 2 de la hackathon de CIX. No es un producto
              oficial de BCP ni de Credicorp.
            </span>
          </p>
        </div>
      </div>
      <ul className="mt-12 grid gap-4 sm:grid-cols-3 lg:mt-16 lg:gap-6">
        {FIGURES.map((f) => (
          <li key={f.value} className="rounded-[20px] bg-bg p-5 sm:p-6">
            <p className="text-3xl font-extrabold tabular-nums text-purple sm:text-4xl">
              {f.value}
            </p>
            <p className="mt-2 text-[15px] leading-snug text-text">{f.text}</p>
            <p className="mt-2 text-sm text-muted">{f.source}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
