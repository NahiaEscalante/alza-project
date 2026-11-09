import type { ReactNode } from 'react';
import { CameraIcon, ChartIcon, DoubleCheck, MicIcon, MoonIcon } from './icons';
import { Eyebrow, Section } from './ui';

/** «Cómo funciona» in 3 steps (4.1, WA-06, WA-10). */
const STEPS: Array<{ title: string; text: ReactNode; art: ReactNode }> = [
  {
    title: 'Manda tu captura',
    text: (
      <>
        Cada vez que te paguen con Yape o Plin, mándale la captura a ALZA. Si vendes en efectivo,
        escríbele o mándale un audio: <i>«vendí 5 soles de pan»</i>.
      </>
    ),
    art: (
      <div className="flex gap-2">
        <StepChip icon={<CameraIcon className="size-[18px]" />}>Captura</StepChip>
        <StepChip icon={<MicIcon className="size-[18px]" />}>Audio</StepChip>
      </div>
    ),
  },
  {
    title: 'Recibe un solo resumen',
    text: (
      <>
        A la hora en que cierras, te llega un mensaje con lo que entró, lo que salió y lo que te
        quedó. Si algo no está claro, te pregunta. Respondes una vez, como prefieras.
      </>
    ),
    art: (
      <div className="flex gap-2">
        <StepChip icon={<MoonIcon className="size-[18px]" />}>9:00 p. m.</StepChip>
        <StepChip>1 mensaje</StepChip>
      </div>
    ),
  },
  {
    title: 'Mira tu semana y gana premios',
    text: (
      <>
        En la web, con tu PIN, ves tu historial y tus puntos. Cada día que cierras suma para
        premios.
      </>
    ),
    art: (
      <div className="flex gap-2">
        <StepChip icon={<ChartIcon className="size-[18px]" />}>Tu semana</StepChip>
        <StepChip>+10 ⭐</StepChip>
      </div>
    ),
  },
];

export function HowItWorks() {
  return (
    <Section id="como-funciona" labelledBy="como-funciona-title">
      <div className="max-w-2xl">
        <Eyebrow>Cómo funciona</Eyebrow>
        <h2
          id="como-funciona-title"
          className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
        >
          Tres pasos. Ninguno te quita tiempo.
        </h2>
        <p className="mt-4 text-lg text-muted">
          Sigues usando WhatsApp como siempre. ALZA se adapta a ti, no al revés.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="relative flex flex-col rounded-[24px] border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,23,47,0.04)]"
          >
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-full bg-navy text-lg font-bold text-white"
            >
              {i + 1}
            </span>
            <h3 className="mt-5 text-xl font-bold text-text">
              <span className="sr-only">Paso {i + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-2 flex-1 text-muted">{step.text}</p>
            <div className="mt-5">{step.art}</div>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-3 rounded-2xl bg-blue-soft px-5 py-4 text-text">
        <span className="mt-0.5 grid h-6 w-7 shrink-0 place-items-center rounded-md bg-white">
          <DoubleCheck className="h-[11px] w-4 text-[#34b7f1]" />
        </span>
        <span>
          <b>Durante el día, ALZA no te escribe.</b> Verás el doble check azul y sigues atendiendo.
          Solo te habla en tu cierre.
        </span>
      </p>
    </Section>
  );
}

function StepChip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-lav-soft px-3 text-sm font-semibold text-purple">
      {icon}
      {children}
    </span>
  );
}
