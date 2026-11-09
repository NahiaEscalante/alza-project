import type { ReactNode } from 'react';
import {
  BanknoteIcon,
  BellOffIcon,
  CalculatorIcon,
  CalendarIcon,
  ChartIcon,
  CheckCircleIcon,
  LockIcon,
  MessageIcon,
  MoonIcon,
  StarIcon,
} from './icons';
import { Eyebrow, Section } from './ui';

/**
 * «Cómo funciona»: 3 steps, each with 3 short sub-steps (4.1, WA-06, WA-10), with the landing's
 * line icons (no emoji, so they match the rest of the page).
 */
const STEPS: Array<{
  title: string;
  items: Array<{ icon: (p: { className?: string }) => ReactNode; title: string; text: string }>;
}> = [
  {
    title: 'Registra tus ventas',
    items: [
      { icon: BanknoteIcon, title: 'Te pagan', text: 'Con Yape, Plin o efectivo.' },
      {
        icon: MessageIcon,
        title: 'Envías el registro',
        text: 'Una captura, audio o mensaje por WhatsApp.',
      },
      { icon: CheckCircleIcon, title: 'ALZA lo guarda', text: 'Sin responderte ni interrumpirte.' },
    ],
  },
  {
    title: 'Recibe tu resumen',
    items: [
      { icon: MoonIcon, title: 'Termina tu día', text: 'Llega la hora de tu cierre.' },
      {
        icon: CalculatorIcon,
        title: 'ALZA hace las cuentas',
        text: 'Calcula lo que entró, salió y quedó.',
      },
      {
        icon: ChartIcon,
        title: 'Ves tus resultados',
        text: 'Y aclaras cualquier dato pendiente.',
      },
    ],
  },
  {
    title: 'Mira tu progreso',
    items: [
      { icon: LockIcon, title: 'Entras con tu PIN', text: 'Revisa tu historial en la web.' },
      { icon: CalendarIcon, title: 'Ves tu semana', text: 'Descubre cuánto vendiste y gastaste.' },
      { icon: StarIcon, title: 'Acumulas puntos', text: 'Cada cierre te acerca a premios.' },
    ],
  },
];

export function HowItWorks() {
  return (
    <Section id="como-funciona" labelledBy="como-funciona-title">
      <div className="max-w-3xl">
        <Eyebrow>Cómo funciona</Eyebrow>
        <h2
          id="como-funciona-title"
          className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
        >
          Tres pasos para tener tus cuentas claras.
        </h2>
        <p className="mt-4 text-lg text-muted">
          Envía tus ventas por WhatsApp. ALZA hace las cuentas por ti.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex flex-col rounded-[24px] border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,23,47,0.04)]"
          >
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-navy text-lg font-bold text-white"
              >
                {i + 1}
              </span>
              <h3 className="text-xl font-bold text-text">
                <span className="sr-only">Paso {i + 1}: </span>
                {step.title}
              </h3>
            </div>
            <div className="my-5 h-px bg-border" aria-hidden="true" />
            <ol className="flex flex-col gap-4">
              {step.items.map(({ icon: ItemIcon, ...item }) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lav-soft text-purple">
                    <ItemIcon className="size-5.5" />
                  </span>
                  <span>
                    <span className="block font-semibold text-text">{item.title}</span>
                    <span className="block text-[15px] leading-snug text-muted">{item.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-3 rounded-2xl bg-blue-soft px-5 py-4 text-text">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-navy">
          <BellOffIcon className="size-5" />
        </span>
        <span>
          <b className="block">Sin mensajes que te interrumpan.</b>
          <span className="text-muted">
            Durante el día, ALZA solo recibe tus registros. Te escribe a la hora de tu cierre.
          </span>
        </span>
      </p>
    </Section>
  );
}
