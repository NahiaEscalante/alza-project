/**
 * Frame of every private screen (D14, 12.2): a top bar (greeting and business on the tabs, a back
 * arrow and a title inside them), the eye that hides amounts (RF-WP-11), the settings gear, and the
 * four tabs at the bottom: Inicio · Movimientos · Premios · Chat.
 */
import { type ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { AlzaLogo } from '../../components/AlzaLogo';
import { useHideAmounts } from '../state/hide-amounts';
import { useSession } from '../state/session';
import {
  BackIcon,
  ChatIcon,
  EyeIcon,
  EyeOffIcon,
  GiftIcon,
  HomeIcon,
  ListIcon,
  SettingsIcon,
} from './icons';

const ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-xl text-text transition-colors hover:bg-white';

function EyeButton() {
  const { hidden, toggle } = useHideAmounts();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? 'Mostrar montos' : 'Ocultar montos'}
      title={hidden ? 'Mostrar montos' : 'Ocultar montos'}
      className={ICON_BUTTON}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

function Greeting() {
  const { profile } = useSession();
  if (!profile) return <AlzaLogo />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <AlzaLogo wordmark={false} size={26} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[17px] font-bold text-navy">
          {profile.firstName ? `Hola, ${profile.firstName}` : 'Hola'}
        </span>
        {profile.businessName && (
          <span className="block truncate text-sm text-muted">{profile.businessName}</span>
        )}
      </span>
    </span>
  );
}

const TABS = [
  {
    href: '/',
    label: 'Inicio',
    Icon: HomeIcon,
    match: (p: string) => p === '/' || p.startsWith('/pendientes'),
  },
  {
    href: '/movimientos',
    label: 'Movimientos',
    Icon: ListIcon,
    match: (p: string) => p.startsWith('/movimientos') || p.startsWith('/descargar'),
  },
  {
    href: '/premios',
    label: 'Premios',
    Icon: GiftIcon,
    match: (p: string) => p.startsWith('/premios'),
  },
  { href: '/chat', label: 'Chat', Icon: ChatIcon, match: (p: string) => p.startsWith('/chat') },
];

function TabBar() {
  const [location] = useLocation();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-110 border-t border-border bg-white px-1 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))]"
    >
      <ul className="grid grid-cols-4">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(location);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-13 flex-col items-center justify-center gap-1 rounded-xl text-sm ${
                  active ? 'font-semibold text-purple' : 'font-medium text-muted hover:text-text'
                }`}
              >
                <Icon className="size-5.5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A private screen. Tabs pass no `back`: they show the greeting. Inner screens pass the parent to
 * go back to and their title.
 */
export function Page({
  title,
  back,
  children,
  docTitle,
}: {
  /** Shown in the top bar of inner screens. */
  title?: string;
  /** Parent route for the back arrow; marks an inner screen. */
  back?: string;
  children: ReactNode;
  /** `<title>`; defaults to `title`. */
  docTitle?: string;
}) {
  const pageTitle = docTitle ?? title;
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · ALZA` : 'ALZA';
  }, [pageTitle]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-110 flex-col">
      <header className="sticky top-0 z-20 flex min-h-15 items-center justify-between gap-2 bg-bg/95 px-3 pt-1.5 backdrop-blur supports-backdrop-filter:bg-bg/85">
        {back ? (
          <span className="flex min-w-0 items-center gap-1">
            <Link href={back} aria-label="Volver" className={ICON_BUTTON}>
              <BackIcon />
            </Link>
            {title && <h1 className="truncate text-lg font-bold text-navy">{title}</h1>}
          </span>
        ) : (
          <div className="flex min-h-11 min-w-0 items-center px-1">
            <Greeting />
          </div>
        )}
        <span className="flex shrink-0 items-center">
          <EyeButton />
          {!back && (
            <Link href="/ajustes" aria-label="Ajustes" title="Ajustes" className={ICON_BUTTON}>
              <SettingsIcon />
            </Link>
          )}
        </span>
      </header>
      <main className="flex-1 px-4 pt-2 pb-[calc(112px+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <TabBar />
    </div>
  );
}
