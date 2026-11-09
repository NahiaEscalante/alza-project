import { Link } from 'wouter';
import { AlzaLogo } from '../components/AlzaLogo';

/** Landing header and footer. */

const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#web', label: 'La web' },
  { href: '#premios', label: 'Premios' },
  { href: '#confianza', label: 'Privacidad' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-[#f7f8fcf0] backdrop-blur supports-[backdrop-filter]:bg-[#f7f8fccc]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="#inicio"
          className="inline-flex min-h-11 items-center"
          aria-label="ALZA, ir al inicio"
        >
          <AlzaLogo />
        </a>
        <nav aria-label="Secciones" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[15px] font-semibold text-muted transition-colors hover:bg-white hover:text-navy"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a
          href="#lista-de-espera"
          className="inline-flex min-h-11 items-center rounded-full bg-purple px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#5c00a0] sm:px-5"
        >
          Quiero probar
        </a>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-md">
          <AlzaLogo />
          <p className="mt-3 text-muted">Tus cuentas claras, sin cambiar tu rutina.</p>
          <p className="mt-6 text-sm text-muted">
            ALZA es un proyecto creado para el Reto 2 de la hackathon de CIX. No es un producto
            oficial de BCP ni de Credicorp. Lo que es de ejemplo se indica en pantalla.
          </p>
        </div>
        <nav aria-label="Enlaces del pie de página">
          <ul className="grid gap-1 text-[15px] font-semibold">
            <li>
              <a
                href="#como-funciona"
                className="inline-flex min-h-11 items-center text-text hover:text-purple"
              >
                Cómo funciona
              </a>
            </li>
            <li>
              <a
                href="#lista-de-espera"
                className="inline-flex min-h-11 items-center text-text hover:text-purple"
              >
                Lista de espera
              </a>
            </li>
            <li>
              <Link
                href="/privacidad"
                className="inline-flex min-h-11 items-center text-text hover:text-purple"
              >
                Privacidad
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-sm text-muted sm:px-6">
          © {new Date().getFullYear()} ALZA · Proyecto del Reto 2, Hackathon CIX
        </p>
      </div>
    </footer>
  );
}
