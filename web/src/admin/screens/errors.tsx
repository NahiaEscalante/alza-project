/** RF-AD-01: failed messages (after 3 retries) and the ones still retrying; «Reintentar». */
import { useState } from 'react';
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyRow,
  ErrorBox,
  Flash,
  Loading,
  Notice,
  PageHeader,
  Panel,
  Table,
  UserCell,
} from '../components';
import { adminApi, errorText, useAdminApi } from '../lib/api';
import { dateTime, MESSAGE_TYPE_LABEL } from '../lib/format';
import type { ErrorsResponse } from '../lib/types';

export function ErrorsScreen() {
  const { data, error, loading, reload } = useAdminApi<ErrorsResponse>('/errors');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function retry(id: string) {
    setBusyId(id);
    setFlash(null);
    try {
      await adminApi.post(`/errors/${id}/retry`);
      setFlash({ tone: 'ok', text: `Mensaje ${id.slice(0, 8)} enviado de nuevo a la cola.` });
      reload();
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function retryAll() {
    setBusyId('all');
    setFlash(null);
    try {
      const res = await adminApi.post<{ retried: number }>('/errors/retry-all');
      setFlash({ tone: 'ok', text: `${res.retried} mensajes enviados de nuevo a la cola.` });
      reload();
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusyId(null);
      setConfirmAll(false);
    }
  }

  const failed = data?.counts.failed ?? 0;

  return (
    <>
      <PageHeader
        title="Mensajes con error"
        description="Mensajes que fallaron después de 3 reintentos (error definitivo) y los que todavía se están reintentando. Solo se muestran identificadores y códigos, nunca el contenido."
        actions={
          <>
            <Btn onClick={reload} disabled={loading}>
              Actualizar
            </Btn>
            <Btn
              tone="primary"
              disabled={!data?.retryAvailable || failed === 0}
              busy={busyId === 'all'}
              onClick={() => setConfirmAll(true)}
            >
              Reintentar todos ({failed})
            </Btn>
          </>
        }
      />
      <Flash flash={flash} />
      {data && !data.retryAvailable && (
        <div className="mb-4">
          <Notice>
            La cola de mensajes no está conectada en este servidor: no se puede reintentar.
          </Notice>
        </div>
      )}
      {error && !data ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : (
        <Panel
          title="Mensajes"
          aside={
            data && (
              <span className="text-sm text-muted">
                {data.counts.failed} con error definitivo · {data.counts.error} reintentando
              </span>
            )
          }
        >
          {!data ? (
            <Loading />
          ) : (
            <Table head={['Recibido', 'Tipo', 'Usuaria', 'Estado', 'Código', 'Intentos', '']}>
              {data.items.length === 0 && (
                <EmptyRow colSpan={7}>No hay mensajes con error. Todo se procesó bien.</EmptyRow>
              )}
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap">{dateTime(item.receivedAt)}</td>
                  <td>{MESSAGE_TYPE_LABEL[item.type] ?? item.type}</td>
                  <td>
                    <UserCell userId={item.userId} phone={item.phone} />
                  </td>
                  <td>
                    {item.status === 'failed' ? (
                      <Badge tone="danger">Error definitivo</Badge>
                    ) : (
                      <Badge tone="warn">Reintentando</Badge>
                    )}
                  </td>
                  <td>
                    <code className="font-mono text-[13px]">{item.errorCode ?? '—'}</code>
                  </td>
                  <td className="tabular-nums">{item.attempts}</td>
                  <td className="text-right">
                    {item.status === 'failed' && (
                      <Btn
                        disabled={!data.retryAvailable || (busyId !== null && busyId !== item.id)}
                        busy={busyId === item.id}
                        onClick={() => void retry(item.id)}
                        aria-label={`Reintentar mensaje ${item.id.slice(0, 8)}`}
                      >
                        Reintentar
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
        open={confirmAll}
        title="¿Reintentar todos los mensajes con error?"
        confirmLabel={`Reintentar ${failed}`}
        busy={busyId === 'all'}
        onConfirm={() => void retryAll()}
        onCancel={() => setConfirmAll(false)}
      >
        Vuelven a la cola, uno por usuaria y en orden de llegada (hasta 200). Si la falla era
        general, revisa primero que el servicio esté bien.
      </ConfirmDialog>
    </>
  );
}
