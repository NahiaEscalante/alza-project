/** RF-AD-04: who did what in the panel, newest first (last 100). */
import { Btn, EmptyRow, ErrorBox, Id, Loading, PageHeader, Panel, Table } from '../components';
import { errorText, useAdminApi } from '../lib/api';
import { ACTION_LABEL, dateTime, detailValue } from '../lib/format';
import type { AuditItem } from '../lib/types';

const TARGET_LABEL: Record<string, string> = {
  admin_user: 'Cuenta',
  inbound_message: 'Mensaje',
  redemption: 'Canje',
  alert: 'Alerta',
  job: 'Tarea',
};

/** One line of the stored detail (ids, counts and outcomes only). */
function detailLine(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) parts.push(`${key}: ${value.length}`);
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        parts.push(`${k}: ${detailValue(v)}`);
      }
    } else parts.push(`${key}: ${detailValue(value)}`);
  }
  return parts.join(' · ');
}

export function AuditScreen() {
  const { data, error, reload } = useAdminApi<{ items: AuditItem[] }>('/audit-log');
  return (
    <>
      <PageHeader
        title="Registro de acciones"
        description="Cada acción del panel queda aquí con quién la hizo y cuándo. Solo identificadores, conteos y resultados."
        actions={<Btn onClick={reload}>Actualizar</Btn>}
      />
      {error && !data ? (
        <ErrorBox message={errorText(error)} onRetry={reload} />
      ) : (
        <Panel>
          {!data ? (
            <Loading />
          ) : (
            <Table head={['Fecha', 'Quién', 'Acción', 'Sobre', 'Detalle']}>
              {data.items.length === 0 && <EmptyRow colSpan={5}>Todavía no hay acciones.</EmptyRow>}
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap">{dateTime(item.at)}</td>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold">{item.admin.name}</span>
                    <span className="block text-xs text-muted">{item.admin.username}</span>
                  </td>
                  <td className="whitespace-nowrap">{ACTION_LABEL[item.action] ?? item.action}</td>
                  <td className="whitespace-nowrap">
                    {item.targetType ? (
                      <>
                        <span className="text-muted">
                          {TARGET_LABEL[item.targetType] ?? item.targetType}
                        </span>{' '}
                        {item.targetType === 'job' ? (
                          <code className="font-mono text-[13px]">{item.targetId}</code>
                        ) : (
                          <Id value={item.targetId} />
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-[13px] text-muted">
                    <div className="max-w-sm truncate" title={detailLine(item.detail)}>
                      {detailLine(item.detail) || '—'}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      )}
    </>
  );
}
