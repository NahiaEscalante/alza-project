/**
 * 13.3 / 4.7 / RF-AD-02: big rewards wait here. Approve → she sees her DEMO code in Premios.
 * Reject → her points come back.
 */
import { useState } from 'react';
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyRow,
  ErrorBox,
  Flash,
  Id,
  Loading,
  PageHeader,
  Panel,
  Table,
  UserCell,
} from '../components';
import { adminApi, errorText, useAdminApi } from '../lib/api';
import { dateTime, points, REDEMPTION_STATUS_LABEL } from '../lib/format';
import type { RedemptionReview, RedemptionsResponse } from '../lib/types';

/** Redemption id with when she asked for it. */
function CreatedCell({ id, createdAt }: { id: string; createdAt: string }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Id value={id} />
      <span className="text-xs whitespace-nowrap text-muted">{dateTime(createdAt)}</span>
    </span>
  );
}

type Decision = { item: RedemptionReview; action: 'approve' | 'reject' };

export function RedemptionsScreen() {
  const { data, error, reload } = useAdminApi<RedemptionsResponse>('/redemptions');
  const [pending, setPending] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function decide() {
    if (!pending) return;
    setBusy(true);
    setFlash(null);
    const { item, action } = pending;
    try {
      const res = await adminApi.post<{ status: string; pointsReturned: number }>(
        `/redemptions/${item.id}/${action}`,
      );
      setFlash({
        tone: 'ok',
        text:
          action === 'approve'
            ? `Canje ${item.id.slice(0, 8)} aprobado: ella ya ve su código en Premios.`
            : `Canje ${item.id.slice(0, 8)} rechazado: se devolvieron ${points(res.pointsReturned)} puntos.`,
      });
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setPending(null);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Canjes en revisión"
        description="Premios grandes (8 semanas activas, 13.3). Aprobar libera el código DEMO-XXXX en su pantalla de Premios; rechazar devuelve los puntos. Los premios son de ejemplo para la demo."
        actions={<Btn onClick={reload}>Actualizar</Btn>}
      />
      <Flash flash={flash} />
      {error && !data ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : !data ? (
        <Panel>
          <Loading />
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          <Panel
            title="Por revisar"
            aside={
              <span className="text-sm text-muted">
                {data.inReview.length === 1 ? '1 pendiente' : `${data.inReview.length} pendientes`}
              </span>
            }
          >
            <Table
              head={[
                'Canje',
                'Usuaria',
                'Premio',
                'Puntos',
                'Semanas activas',
                'Alertas abiertas',
                '',
              ]}
            >
              {data.inReview.length === 0 && (
                <EmptyRow colSpan={7}>No hay canjes esperando revisión.</EmptyRow>
              )}
              {data.inReview.map((item) => (
                <tr key={item.id}>
                  <td>
                    <CreatedCell id={item.id} createdAt={item.createdAt} />
                  </td>
                  <td>
                    <UserCell userId={item.userId} phone={item.phone} />
                  </td>
                  <td>
                    {item.rewardName} <Badge tone="purple">Ejemplo</Badge>
                  </td>
                  <td className="tabular-nums">{points(item.points)}</td>
                  <td className="tabular-nums">
                    {item.activeWeeks >= item.requiredActiveWeeks ? (
                      <Badge tone="ok">
                        {item.activeWeeks} de {item.requiredActiveWeeks}
                      </Badge>
                    ) : (
                      <Badge tone="warn">
                        {item.activeWeeks} de {item.requiredActiveWeeks}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {item.openAlerts > 0 ? (
                      <Badge tone="danger">{item.openAlerts}</Badge>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Btn tone="primary" onClick={() => setPending({ item, action: 'approve' })}>
                        Aprobar
                      </Btn>
                      <Btn onClick={() => setPending({ item, action: 'reject' })}>Rechazar</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Últimas decisiones">
            <Table head={['Canje', 'Usuaria', 'Premio', 'Puntos', 'Resultado', 'Revisó']}>
              {data.reviewed.length === 0 && (
                <EmptyRow colSpan={6}>Todavía no hay decisiones tomadas en el panel.</EmptyRow>
              )}
              {data.reviewed.map((item) => (
                <tr key={item.id}>
                  <td>
                    <CreatedCell id={item.id} createdAt={item.createdAt} />
                  </td>
                  <td>
                    <UserCell userId={item.userId} phone={item.phone} />
                  </td>
                  <td>{item.rewardName}</td>
                  <td className="tabular-nums">{points(item.points)}</td>
                  <td>
                    <Badge tone={item.status === 'delivered' ? 'ok' : 'neutral'}>
                      {REDEMPTION_STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
                  </td>
                  <td>{item.reviewedBy?.name ?? '—'}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === 'approve' ? '¿Aprobar este canje?' : '¿Rechazar este canje?'}
        confirmLabel={pending?.action === 'approve' ? 'Aprobar y liberar código' : 'Rechazar'}
        tone={pending?.action === 'approve' ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={() => void decide()}
        onCancel={() => setPending(null)}
      >
        {pending?.action === 'approve' ? (
          <>
            Se genera un código DEMO-XXXX y ella lo ve en Premios. Los {points(pending.item.points)}{' '}
            puntos quedan canjeados.
          </>
        ) : (
          <>
            Le devolvemos {points(pending?.item.points ?? 0)} puntos a su saldo. No se puede
            deshacer.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
