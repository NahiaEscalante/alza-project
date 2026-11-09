/**
 * «Descargar mi historial» (4.8, 5.10, 12.2, HU-14): she picks the period, confirms with her PIN
 * and gets a PDF and an Excel with where each figure comes from. Sharing them is her decision
 * (14.1). Below a divider, Yape and Mibanco with their logos (PR05, D44): plain links to their
 * official sites, never «calificas para», per the approved download screen copy (D70).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { DownloadIcon, LockIcon } from '../components/icons';
import { Page } from '../components/shell';
import { Button, buttonClass, Card, FieldError } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { addDays, longDayLabel, todayBusinessDay, weekStart } from '../lib/format';
import { isPinCancelled, usePinGate } from '../state/pin';

type Period = '4_weeks' | '12_weeks' | 'all';

/** `POST /api/reports`. */
interface ReportResponse {
  id: string;
  period: Period;
  pdfUrl: string;
  xlsxUrl: string;
  pdfSizeBytes: number;
  xlsxSizeBytes: number;
}

const FILE_NAME: Record<Period, string> = {
  '4_weeks': '4-semanas',
  '12_weeks': '12-semanas',
  all: 'todo',
};

/** Whole weeks, Monday to Sunday, up to today (D60). */
function periodHelp(period: Period): string {
  if (period === 'all') return 'Desde tu primer registro';
  const weeks = period === '4_weeks' ? 4 : 12;
  const from = addDays(weekStart(todayBusinessDay()), -7 * (weeks - 1));
  return `Desde el ${longDayLabel(from)} hasta hoy`;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '4_weeks', label: '4 semanas' },
  { value: '12_weeks', label: '12 semanas' },
  { value: 'all', label: 'Todo' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function DownloadScreen() {
  const withPin = usePinGate();
  const [period, setPeriod] = useState<Period>('12_weeks');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const errorId = useId();

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await withPin(() => api.post<ReportResponse>('/reports', { period })));
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Descargar mi historial" back="/movimientos">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="mb-2 text-lg font-bold text-text">¿Qué periodo?</legend>
            {PERIODS.map((option) => {
              const on = period === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[14px] border px-3.5 py-3 ${
                    on ? 'border-navy bg-blue-soft' : 'border-border bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="period"
                    value={option.value}
                    checked={on}
                    onChange={() => {
                      setPeriod(option.value);
                      setReport(null);
                      setError(null);
                    }}
                    className="mt-1 size-5 shrink-0 accent-navy"
                  />
                  <span>
                    <span className="block text-base font-semibold">{option.label}</span>
                    <span className="block text-sm text-muted">{periodHelp(option.value)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="mt-4 text-base text-text">
            Incluye PDF y Excel, con de dónde viene cada dato.
          </p>
          <p className="mt-1 text-[15px] text-muted">Tus clientes salen solo con sus iniciales.</p>
          <FieldError id={errorId}>{error}</FieldError>
          <Button
            type="submit"
            loading={busy}
            className="mt-4"
            aria-describedby={error ? errorId : undefined}
          >
            {!busy && <LockIcon className="size-5" />}
            {busy ? 'Preparando tu historial…' : 'Descargar'}
          </Button>
          <p className="mt-2 text-center text-sm text-muted">Te pediremos tu PIN.</p>
        </form>
      </Card>

      {report && <ReportReady report={report} />}

      <hr className="my-6 border-border" />
      <PartnerLinks />
    </Page>
  );
}

function ReportReady({ report }: { report: ReportResponse }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Announce it and bring the two buttons above the tab bar.
  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.focus({ preventScroll: true });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    title.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const name = `alza-historial-${FILE_NAME[report.period]}`;

  return (
    <Card as="section" className="mt-4 flex flex-col gap-3">
      <h2
        ref={titleRef}
        tabIndex={-1}
        className="scroll-mt-24 text-lg font-bold text-text outline-none"
      >
        Tu historial está listo
      </h2>
      <a href={report.pdfUrl} download={`${name}.pdf`} className={buttonClass('primary')}>
        <DownloadIcon className="size-5" />
        Descargar PDF
        <span className="text-sm font-medium opacity-85">· {formatSize(report.pdfSizeBytes)}</span>
      </a>
      <a href={report.xlsxUrl} download={`${name}.xlsx`} className={buttonClass('outline')}>
        <DownloadIcon className="size-5" />
        Descargar Excel
        <span className="text-sm font-medium text-muted">· {formatSize(report.xlsxSizeBytes)}</span>
      </a>
      <p className="flex gap-2.5 rounded-[14px] bg-bg px-3.5 py-3 text-[15px] text-text">
        <LockIcon className="mt-0.5 size-5 shrink-0 text-navy" />
        <span>Nadie más ve tu historial. Tú decides si lo compartes y con quién.</span>
      </p>
    </Card>
  );
}

const PARTNERS = [
  {
    name: 'Yape',
    href: 'https://www.yape.com.pe/',
    src: '/logos/yape.png',
    width: 234,
    height: 299,
    className: 'h-12',
  },
  {
    name: 'Mibanco',
    href: 'https://www.mibanco.com.pe/',
    src: '/logos/mibanco.svg',
    width: 103,
    height: 52,
    className: 'h-10',
  },
];

/** PR05: only here, only «Conoce opciones», never a promise. */
function PartnerLinks() {
  return (
    <section aria-labelledby="partners-title">
      <h2 id="partners-title" className="mx-1 mb-3 text-base font-semibold text-text">
        Conoce opciones para tu negocio en:
      </h2>
      <ul className="grid grid-cols-2 gap-3">
        {PARTNERS.map((partner) => (
          <li key={partner.name}>
            <a
              href={partner.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-20 items-center justify-center rounded-[18px] border border-border bg-white px-4 py-3 transition-colors hover:bg-blue-soft"
            >
              <img
                src={partner.src}
                alt={partner.name}
                width={partner.width}
                height={partner.height}
                className={`${partner.className} w-auto`}
              />
              <span className="sr-only"> (abre su sitio oficial)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
