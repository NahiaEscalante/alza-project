/**
 * `/app/*`: the user's web (Fase 7, spec 4.6, 5.7, 5.8, 12.2), loaded on demand so the landing
 * stays light (RNF-06). Routes are relative to `/app` (wouter `nest`):
 *
 * | Route                             | Screen                                         |
 * |-----------------------------------|------------------------------------------------|
 * | /activar/:token                   | Create the PIN (1-hour link, HU-09)            |
 * | /entrar/:token                    | 7-day link: straight in or PIN (HU-10)         |
 * | /                                 | Inicio                                         |
 * | /pendientes                       | Pendientes                                     |
 * | /movimientos?semana=YYYY-MM-DD    | Movimientos, by week                           |
 * | /movimientos/:date                | One day                                        |
 * | /movimientos/:date/agregar        | «Agregar algo que faltó» (past days)           |
 * | /movimientos/:date/:entryId       | One record: correct, change type, remove       |
 * | /premios                          | Premios                                        |
 * | /chat                             | Chat: questions and proposed changes (Fase 8)  |
 * | /ajustes                          | Ajustes                                        |
 * | /descargar                        | Descargar mi historial (HU-14)                 |
 */
import { useEffect } from 'react';
import { Route, Switch } from 'wouter';
import { AlzaLogo } from '../components/AlzaLogo';
import { ErrorState, Spinner } from './components/ui';
import { isIsoDate } from './lib/format';
import { AddEntryScreen } from './screens/add-entry';
import { ActivateScreen, EnterScreen, NoSessionScreen } from './screens/auth';
import { ChatScreen } from './screens/chat';
import { DayScreen } from './screens/day';
import { DownloadScreen } from './screens/download';
import { EntryScreen } from './screens/entry';
import { HomeScreen } from './screens/home';
import { MovementsScreen } from './screens/movements';
import { PendingScreen } from './screens/pending';
import { AppNotFound } from './screens/placeholders';
import { RewardsScreen } from './screens/rewards';
import { SettingsScreen } from './screens/settings';
import { HideAmountsProvider } from './state/hide-amounts';
import { PinGateProvider } from './state/pin';
import { SessionProvider, useSession } from './state/session';
import { ToastProvider } from './state/toast';
import './app.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AppRoot() {
  return (
    <SessionProvider>
      <HideAmountsProvider>
        <ToastProvider>
          <Switch>
            <Route path="/activar/:token?">
              {(params) => <ActivateScreen token={params.token} />}
            </Route>
            <Route path="/entrar/:token?">{(params) => <EnterScreen token={params.token} />}</Route>
            <Route>
              <PrivateApp />
            </Route>
          </Switch>
        </ToastProvider>
      </HideAmountsProvider>
    </SessionProvider>
  );
}

/** Everything behind the session (a remembered phone, 14.3). */
function PrivateApp() {
  const { status, notice, check } = useSession();

  useEffect(() => {
    if (status === 'unknown') check();
  }, [status, check]);

  if (status === 'unknown' || status === 'checking') {
    return (
      <div
        role="status"
        className="mx-auto flex min-h-dvh max-w-110 flex-col items-center justify-center gap-4"
      >
        <AlzaLogo />
        <Spinner className="size-7 text-purple" />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-110 flex-col justify-center px-4">
        <ErrorState
          message="No pudimos conectarnos. Revisa tu internet e intenta de nuevo."
          onRetry={check}
        />
      </div>
    );
  }
  if (status === 'out') return <NoSessionScreen notice={notice} />;

  return (
    <PinGateProvider>
      <Switch>
        <Route path="/" component={HomeScreen} />
        <Route path="/pendientes" component={PendingScreen} />
        <Route path="/movimientos" component={MovementsScreen} />
        <Route path="/movimientos/:date">
          {({ date }) => (isIsoDate(date) ? <DayScreen date={date} /> : <AppNotFound />)}
        </Route>
        <Route path="/movimientos/:date/agregar">
          {({ date }) => (isIsoDate(date) ? <AddEntryScreen date={date} /> : <AppNotFound />)}
        </Route>
        <Route path="/movimientos/:date/:entryId">
          {({ date, entryId }) =>
            isIsoDate(date) && UUID.test(entryId) ? (
              <EntryScreen date={date} entryId={entryId} />
            ) : (
              <AppNotFound />
            )
          }
        </Route>
        <Route path="/premios" component={RewardsScreen} />
        <Route path="/chat" component={ChatScreen} />
        <Route path="/ajustes" component={SettingsScreen} />
        <Route path="/descargar" component={DownloadScreen} />
        <Route component={AppNotFound} />
      </Switch>
    </PinGateProvider>
  );
}
