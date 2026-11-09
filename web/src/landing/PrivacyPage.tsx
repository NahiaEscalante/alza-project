import { type ReactNode, useEffect } from 'react';
import { Link } from 'wouter';
import { AlzaLogo } from '../components/AlzaLogo';
import { WAITLIST_CONSENT_LABEL, WAITLIST_CONSENT_TEXT } from './consent';

/**
 * `/privacidad`: preliminary privacy summary (14.1, 14.2, 14.6, D52). The final text is pending
 * legal review (18.3), and the page says so.
 */
export function PrivacyPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'Privacidad · ALZA';
    return () => {
      document.title = 'ALZA';
    };
  }, []);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center"
            aria-label="ALZA, ir al inicio"
          >
            <AlzaLogo />
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-purple">
            Volver al inicio
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-[32px] font-extrabold leading-tight text-navy sm:text-4xl">
          Cómo cuidamos tus datos
        </h1>
        <p className="mt-3 inline-flex rounded-full bg-[#eef2f8] px-3 py-1 text-sm font-semibold text-muted">
          Versión preliminar: el texto final está en revisión.
        </p>

        <Block title="Lista de espera">
          <p>Cuando te anotas en la lista de espera guardamos solo esto:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>tu nombre;</li>
            <li>tu celular;</li>
            <li>el nombre de tu negocio, si lo escribiste;</li>
            <li>la versión del texto que aceptaste y la fecha.</li>
          </ul>
          <p className="mt-3">
            Lo usamos solo para avisarte cuando puedas probar ALZA. Lo guardamos hasta 6 meses o
            hasta que te invitemos al piloto, y lo borramos antes si nos lo pides.
          </p>
          <blockquote className="mt-4 rounded-2xl border border-border bg-white p-4 text-[15px]">
            «{WAITLIST_CONSENT_TEXT}»
            <footer className="mt-2 text-sm text-muted">{WAITLIST_CONSENT_LABEL}</footer>
          </blockquote>
        </Block>

        <Block title="Cuando usas ALZA">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Antes de guardar o leer cualquier cosa, ALZA te pide permiso en su chat. Si no
              aceptas, no se guarda nada.
            </li>
            <li>
              Guardamos lo que nos mandas (capturas, audios y mensajes) para llevar tus cuentas.
              Para leerlos usamos servicios de inteligencia artificial y de nube que pueden estar
              fuera del Perú.
            </li>
            <li>
              Las fotos y audios originales se borran a los 30 días. Quedan los datos que leímos de
              ellos.
            </li>
            <li>Tus registros, cierres y puntos se guardan mientras tu cuenta exista.</li>
            <li>
              En la demo pública, el chat de ALZA funciona en Telegram: tus mensajes pasan por
              Telegram y tu cuenta se crea con el número que compartes ahí. Es una demo: usa
              capturas y datos de prueba, no los reales de tu negocio.
            </li>
            <li>De tus clientes guardamos lo mínimo; en tu reporte solo aparecen sus iniciales.</li>
          </ul>
        </Block>

        <Block title="Tus derechos">
          <ul className="list-disc space-y-2 pl-6">
            <li>Ver tus datos: en la web y descargando tu historial.</li>
            <li>Corregirlos: desde la web o el chat.</li>
            <li>
              Borrarlos: escribe «borra mis datos» en el chat de ALZA o hazlo desde la web. Borramos
              todo en 48 horas o menos.
            </li>
          </ul>
        </Block>

        <p className="mt-10 text-sm text-muted">
          ALZA es un proyecto creado para el Reto 2 de la hackathon de CIX. No es un producto
          oficial de BCP ni de Credicorp.
        </p>
      </main>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-text">{title}</h2>
      <div className="mt-3 text-text">{children}</div>
    </section>
  );
}
