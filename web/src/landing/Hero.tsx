import { ChatDemo } from './ChatDemo';
import { CheckIcon } from './icons';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './ui';

const PERKS = ['Sin descargar otra app', 'Sin aprender contabilidad', 'Premios por ser constante'];

/**
 * Value proposition (spec 1.3, condensed) with the animated WhatsApp mock. On phones the mock
 * comes right after the buttons (it peeks into the first screen); the perks go below it.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      {/* Soft color fields (radial gradients: cheaper than blur filters on low-end phones). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_85%_15%,#efe7ff_0%,transparent_70%),radial-gradient(50%_30%_at_0%_60%,#e4f8f5_0%,transparent_70%)] [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
      />
      <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-10 px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:grid-cols-[1.1fr_1fr] lg:grid-rows-[auto_auto] lg:gap-y-8 lg:pb-20 lg:pt-10">
        <div className="lg:row-start-1 lg:self-end">
          <h1
            id="hero-title"
            className="text-[40px] font-extrabold leading-[1.05] tracking-[-0.02em] text-navy sm:text-[56px] lg:text-[64px]"
          >
            Tus cuentas{' '}
            <span className="relative whitespace-nowrap text-purple">
              claras
              <svg
                aria-hidden="true"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                className="absolute -bottom-1 left-0 h-3 w-full text-mint"
              >
                <path
                  d="M2 9c40-6 120-8 196-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            , sin cambiar tu rutina.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
            Mándale a ALZA tus capturas de Yape y Plin por WhatsApp y cuéntale tus ventas en
            efectivo. En la noche te llega <b className="text-text">un solo mensaje</b>: cuánto
            entró, cuánto salió y cuánto te quedó.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#lista-de-espera" className={BUTTON_PRIMARY}>
              Quiero probar ALZA
            </a>
            <a href="#como-funciona" className={BUTTON_SECONDARY}>
              ¿Cómo funciona?
            </a>
          </div>
        </div>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <p className="sr-only">
            Ejemplo de un día con ALZA en WhatsApp. Durante el día, Marta manda la captura de un
            Yape de 12,50 soles, un audio con una venta en efectivo y la captura de un pago de 150
            soles a su distribuidor. ALZA no responde: solo aparece el doble check azul. A las 9 de
            la noche llega un solo mensaje: entró 412 soles, salió 180 y le quedaron 232, con tres
            dudas numeradas. Marta responde en un mensaje y recibe: «Martes cerrado completo. Más 10
            puntos. Tienes 340».
          </p>
          <ChatDemo />
        </div>

        <div className="lg:row-start-2 lg:self-start">
          <ul className="flex flex-col gap-2.5 text-[15px] text-text sm:flex-row sm:flex-wrap sm:gap-x-6">
            {PERKS.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-[#e4f8f5] text-ok">
                  <CheckIcon className="size-3.5 stroke-[3]" />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-muted">
            Funciona con tus capturas de
            <img src="/logos/yape.png" alt="Yape" width={28} height={36} className="h-9 w-auto" />
            <span>
              y <b className="font-semibold text-text">Plin</b>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
