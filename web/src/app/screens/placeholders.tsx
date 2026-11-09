/** The in-app «not found». */
import { Link } from 'wouter';
import { InfoIcon } from '../components/icons';
import { Page } from '../components/shell';
import { buttonClass, EmptyState } from '../components/ui';

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
