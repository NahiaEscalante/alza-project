/**
 * 13.4 / D22 / D28 / D62 / RF-AD-02: flagged patterns and PIN lockouts. Nothing is blocked by an
 * alert, except a repeated holder: while open, her days close without points. «Resolver» turns
 * points back on from the next 12:00; withheld points are not paid afterwards (D62).
 */
import { useState } from 'react';
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyRow,
  ErrorBox,
  Flash,
  Loading,
  PageHeader,
  Panel,
  Table,
  UserCell,
} from '../components';
import { adminApi, errorText, useAdminApi } from '../lib/api';
import {
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  DETAIL_LABEL,
  dateTime,
  detailValue,
} from '../lib/format';
import type { AlertItem, AlertsResponse } from '../lib/types';

const CLOSE_NOTICE: Record<string, string> = { pending: 'pendiente', shown: 'mostrado' };

/** Bookkeeping keys the team does not need here (who reviewed is in the audit log). */
const HIDDEN_DETAIL = new Set(['reviewedBy', 'shownAt']);

function DetailList({ detail }: { detail: AlertItem['detail'] }) {
  const entries = Object.entries(detail).filter(([key]) => !HIDDEN_DETAIL.has(key));
  if (entries.length === 0) return <span className="text-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-[13px]">
      {entries.map(([key, value]) => (
        <li key={key} className="whitespace-nowrap">
          <span className="text-muted">{DETAIL_LABEL[key] ?? key}:</span>{' '}
          <span className="font-mono" title={String(value)}>
            {key === 'closeNotice'
              ? (CLOSE_NOTICE[String(value)] ?? String(value))
              : detailValue(value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AlertsScreen() {
  const [filter, setFilter] = useState<'open' | 'closed'>('open');
  const { data, error, reload } = useAdminApi<AlertsResponse>(`/alerts?status=${filter}`);
  const [pending, setPending] = useState<AlertItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function review() {
    if (!pending) return;
    setBusy(true);
    setFlash(null);
    try {
      await adminApi.post(`/alerts/${pending.id}/review`, { outcome: 'reviewed' });
      setFlash({
        tone: 'ok',
        text:
          pending.type === 'duplicate_account_holder'
            ? `Alerta ${pending.id.slice(0, 8)} resuelta: vuelve a sumar puntos desde el próximo cierre.`
            : `Alerta ${pending.id.slice(0, 8)} marcada como revisada.`,
      });
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setPending(null);
      reload();
    }
  }

  const tab = (value: 'open' | 'closed', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={filter === value}
      onClick={() => setFilter(value)}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
        filter === value ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Patrones marcados para revisión (13.4) y bloqueos de PIN. No bloquean nada, salvo el titular repetido: mientras esté abierta, sus días se cierran sin puntos."
        actions={<Btn onClick={reload}>Actualizar</Btn>}
      />
      <Flash flash={flash} />
      <div
        role="tablist"
        aria-label="Estado"
        className="mb-4 inline-flex rounded-lg bg-[#eef2f8] p-1"
      >
        {tab('open', `Abiertas${data && filter === 'open' ? ` (${data.openCount})` : ''}`)}
        {tab('closed', 'Revisadas')}
      </div>
      {error && !data ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : (
        <Panel>
          {!data ? (
            <Loading />
          ) : (
            <Table head={['Fecha', 'Tipo', 'Usuaria', 'Detalle', 'Estado', '']}>
              {data.items.length === 0 && (
                <EmptyRow colSpan={6}>
                  {filter === 'open'
                    ? 'No hay alertas abiertas.'
                    : 'Todavía no hay alertas revisadas.'}
                </EmptyRow>
              )}
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap">{dateTime(item.createdAt)}</td>
                  <td>
                    <span className="font-semibold">
                      {ALERT_TYPE_LABEL[item.type] ?? item.type}
                    </span>
                    {item.withholdsPoints && (
                      <span className="mt-1 block">
                        <Badge tone="danger">Sin puntos hasta revisar</Badge>
                      </span>
                    )}
                  </td>
                  <td>
                    <UserCell userId={item.userId} phone={item.phone} />
                  </td>
                  <td>
                    <DetailList detail={item.detail} />
                  </td>
                  <td>
                    <Badge tone={item.status === 'open' ? 'warn' : 'neutral'}>
                      {ALERT_STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
                  </td>
                  <td className="text-right">
                    {item.status === 'open' && (
                      <Btn
                        tone={item.type === 'duplicate_account_holder' ? 'primary' : 'secondary'}
                        onClick={() => setPending(item)}
                      >
                        {item.type === 'duplicate_account_holder' ? 'Resolver' : 'Marcar revisada'}
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.type === 'duplicate_account_holder'
            ? '¿Resolver el titular repetido?'
            : '¿Marcar la alerta como revisada?'
        }
        confirmLabel={pending?.type === 'duplicate_account_holder' ? 'Resolver' : 'Marcar revisada'}
        busy={busy}
        onConfirm={() => void review()}
        onCancel={() => setPending(null)}
      >
        {pending?.type === 'duplicate_account_holder'
          ? 'Esta cuenta vuelve a sumar puntos desde el próximo cierre de las 12:00. Los puntos que no sumó mientras la alerta estuvo abierta no se pagan después (D62).'
          : 'La alerta pasa a «Revisadas». No cambia nada en su cuenta.'}
      </ConfirmDialog>
    </>
  );
}
