/** Screens that arrive in Fase 8 (chat, report download) and the in-app «not found». */
import { Link } from 'wouter';
import { ChatIcon, DownloadIcon, InfoIcon } from '../components/icons';
import { Page } from '../components/shell';
import { buttonClass, EmptyState, PageTitle } from '../components/ui';

export function ChatScreen() {
  return (
    <Page docTitle="Chat">
      <PageTitle>Chat</PageTitle>
      <div className="rounded-[18px] border border-border bg-card px-2">
        <EmptyState icon={<ChatIcon />} title="Muy pronto">
          <p>Podrás preguntarme cosas como:</p>
          <p className="mt-3 flex flex-col items-center gap-2">
            <span className="rounded-2xl rounded-br-sm bg-lav-soft px-4 py-2 text-text">
              ¿Cuánto vendí el martes?
            </span>
            <span className="rounded-2xl rounded-br-sm bg-lav-soft px-4 py-2 text-text">
              ¿Cuántos puntos me faltan?
            </span>
          </p>
          <p className="mt-4">Mientras tanto, revisa tus días en Movimientos.</p>
        </EmptyState>
      </div>
      <Link href="/movimientos" className={`${buttonClass('secondary')} mt-4`}>
        Ir a Movimientos
      </Link>
    </Page>
  );
}

export function DownloadScreen() {
  return (
    <Page title="Descargar mi historial" back="/movimientos">
      <div className="rounded-[18px] border border-border bg-card px-2">
        <EmptyState icon={<DownloadIcon />} title="Muy pronto">
          Podrás descargar tu historial en PDF y Excel, con de dónde viene cada dato, para mostrarlo
          cuando lo necesites.
        </EmptyState>
      </div>
      <Link href="/movimientos" className={`${buttonClass('secondary')} mt-4`}>
        Volver a Movimientos
      </Link>
    </Page>
  );
}

export function AppNotFound() {
  return (
    <Page title="No encontrado" back="/">
      <EmptyState icon={<InfoIcon />} title="No encontramos esta página">
        Puede que el enlace esté incompleto.
      </EmptyState>
      <Link href="/" className={buttonClass('primary')}>
        Ir a Inicio
      </Link>
    </Page>
  );
}
