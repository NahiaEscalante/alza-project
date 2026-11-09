import { lazy, Suspense } from 'react';
import { Link, Route, Switch } from 'wouter';
import { AlzaLogo } from './components/AlzaLogo';
import { Landing } from './landing/Landing';
import { PrivacyPage } from './landing/PrivacyPage';

// The user's web is split out so the public landing stays light (RNF-06).
const AppRoot = lazy(() => import('./app/AppRoot'));
// Internal panel for the team (Fase 8c), also on demand.
const AdminRoot = lazy(() => import('./admin/AdminRoot'));

export function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/privacidad" component={PrivacyPage} />
      <Route path="/app" nest>
        <Suspense fallback={null}>
          <AppRoot />
        </Suspense>
      </Route>
      <Route path="/panel" nest>
        <Suspense fallback={null}>
          <AdminRoot />
        </Suspense>
      </Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4">
      <AlzaLogo />
      <p>No encontramos esta página.</p>
      <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-purple">
        Ir al inicio
      </Link>
    </main>
  );
}
