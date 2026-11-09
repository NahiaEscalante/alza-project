import { lazy, Suspense } from 'react';
import { Link, Route, Switch } from 'wouter';
import { AlzaLogo } from './components/AlzaLogo';
import { Landing } from './landing/Landing';
import { PrivacyPage } from './landing/PrivacyPage';

// The user's web is split out so the public landing stays light (RNF-06).
const AppHome = lazy(() => import('./routes/AppHome'));

export function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/privacidad" component={PrivacyPage} />
      <Route path="/app" nest>
        <Suspense fallback={null}>
          <AppHome />
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
