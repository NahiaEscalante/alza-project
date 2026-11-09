import { Link } from 'wouter';
import { HandIcon, HistoryIcon, SearchCheckIcon, TrashIcon } from './icons';
import { Eyebrow, Section } from './ui';

/** Privacidad y confianza (1.5, 14.1, 14.2, 14.6, PR07). */
const POINTS = [
  {
    icon: HandIcon,
    title: 'Tú decides',
    text: 'Antes de guardar algo, ALZA te pide permiso. Si no aceptas, no se guarda nada.',
  },
  {
    icon: SearchCheckIcon,
    title: 'ALZA no inventa montos',
    text: 'Si una captura no se lee bien, te pregunta. Nunca adivina una cifra.',
  },
  {
    icon: HistoryIcon,
    title: 'Tus registros no se borran sin tu permiso',
    text: 'Si corriges algo, queda anotado qué cambió y cuándo.',
  },
  {
    icon: TrashIcon,
    title: 'Puedes pedir que borremos tus datos',
    text: 'Escribe «borra mis datos» y lo hacemos. Las fotos y audios originales se borran solos a los 30 días.',
  },
];

export function Trust() {
  return (
    <Section id="confianza" labelledBy="confianza-title" className="bg-navy text-white">
      <div className="max-w-2xl">
        <Eyebrow tone="light">Privacidad y confianza</Eyebrow>
        <h2
          id="confianza-title"
          className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight sm:text-4xl"
        >
          Tu negocio es tuyo. Tus datos, también.
        </h2>
        <p className="mt-4 text-lg text-[#d6ddf5]">
          ALZA te dice siempre de dónde sale cada cifra y qué hace con lo que le mandas.
        </p>
      </div>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <li
            key={title}
            className="flex gap-4 rounded-[24px] bg-white/[0.07] p-5 ring-1 ring-white/10 sm:block sm:p-6"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-navy">
              <Icon className="size-6" />
            </span>
            <span className="block">
              <h3 className="text-lg font-bold leading-snug sm:mt-5">{title}</h3>
              <p className="mt-1.5 text-[#d6ddf5] sm:mt-2">{text}</p>
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/privacidad"
        className="mt-8 inline-flex min-h-11 items-center gap-2 font-semibold text-white underline decoration-[#c9b6ff] decoration-2 underline-offset-4 hover:decoration-white"
      >
        Lee cómo cuidamos tus datos
      </Link>
    </Section>
  );
}
