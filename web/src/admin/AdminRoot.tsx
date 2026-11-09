/**
 * `/panel/*`: the internal panel for the team (Fase 8c, spec 5.12, 14.4), loaded on demand so
 * neither the landing nor her web carry it. Desktop-first. Routes are relative to `/panel`:
 *
 * | Route         | Screen                                                         |
 * |---------------|----------------------------------------------------------------|
 * | /errores      | Failed messages and «Reintentar» (RF-AD-01)                    |
 * | /canjes       | Big rewards in review: approve or reject (13.3, RF-AD-02)      |
 * | /alertas      | Antifraud and PIN alerts (13.4, D28, D62)                      |
 * | /metricas     | Metrics of 13.5 (RF-AD-03)                                     |
 * | /herramientas | Demo tools: finalize closes, antifraud scan, WA-17             |
 * | /registro     | Who did what (RF-AD-04)                                        |
 */
import { useEffect } from 'react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { AlzaLogo } from '../components/AlzaLogo';
import { Btn, ErrorBox, Spinner } from './components';
import { AlertsScreen } from './screens/alerts';
import { AuditScreen } from './screens/audit';
import { ErrorsScreen } from './screens/errors';
import { LoginScreen } from './screens/login';
import { MetricsScreen } from './screens/metrics';
import { RedemptionsScreen } from './screens/redemptions';
import { ToolsScreen } from './screens/tools';
import { AdminSessionProvider, useAdminSession } from './session';

const NAV = [
  { href: '/errores', label: 'Mensajes con error' },
  { href: '/canjes', label: 'Canjes en revisión' },
  { href: '/alertas', label: 'Alertas' },
  { href: '/metricas', label: 'Métricas' },
  { href: '/herramientas', label: 'Herramientas demo' },
  { href: '/registro', label: 'Registro de acciones' },
];

export default function AdminRoot() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Panel interno · ALZA';
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <AdminSessionProvider>
      <Gate />
    </AdminSessionProvider>
  );
}

function Gate() {
  const { status, check } = useAdminSession();
  if (status === 'checking') {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center gap-3 text-muted">
        <Spinner className="size-6 text-purple" /> Cargando…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <ErrorBox message="No pudimos conectarnos con el servidor." onRetry={check} />
      </div>
    );
  }
  if (status === 'out') return <LoginScreen />;
  return <Shell />;
}

function Shell() {
  const { admin, logout } = useAdminSession();
  const [location] = useLocation();
  return (
    <div className="grid min-h-dvh grid-cols-[248px_1fr]">
      <aside className="sticky top-0 flex h-dvh flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <AlzaLogo />
          <span className="rounded-md bg-navy px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
            Panel
          </span>
        </div>
        <nav aria-label="Secciones del panel" className="flex flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-[15px] font-medium no-underline transition-colors ${
                  active ? 'bg-lav-soft text-purple' : 'text-text hover:bg-[#f1f4f9]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border px-5 py-4">
          <p className="truncate text-sm font-semibold text-text">{admin?.name}</p>
          <p className="truncate text-xs text-muted">{admin?.username}</p>
          <Btn tone="ghost" className="mt-2 -ml-3" onClick={() => void logout()}>
            Cerrar sesión
          </Btn>
        </div>
      </aside>
      <main className="min-w-0 px-8 py-7">
        <div className="mx-auto max-w-6xl">
          <Switch>
            <Route path="/">
              <Redirect to="/errores" replace />
            </Route>
            <Route path="/errores" component={ErrorsScreen} />
            <Route path="/canjes" component={RedemptionsScreen} />
            <Route path="/alertas" component={AlertsScreen} />
            <Route path="/metricas" component={MetricsScreen} />
            <Route path="/herramientas" component={ToolsScreen} />
            <Route path="/registro" component={AuditScreen} />
            <Route>
              <p className="text-muted">No encontramos esta sección del panel.</p>
            </Route>
          </Switch>
          <p className="mt-10 text-xs text-muted">
            Uso interno del equipo ALZA. Solo identificadores y totales: sin textos de mensajes ni
            nombres junto a montos. Cada acción queda registrada con quién la hizo.
          </p>
        </div>
      </main>
    </div>
  );
}
