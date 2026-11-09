import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { WAITLIST_CONSENT_LABEL, WAITLIST_CONSENT_TEXT, WAITLIST_CONSENT_VERSION } from './consent';
import { AlertIcon, CheckIcon } from './icons';
import { JuryQr } from './JuryQr';
import { normalizePeruMobile } from './phone';
import { BUTTON_PRIMARY, Eyebrow, Section } from './ui';

/** Waitlist (D43, D52): POST /api/waitlist with the consent version. */

type Field = 'name' | 'phone' | 'businessName' | 'consent';
type Errors = Partial<Record<Field, string>>;

const MESSAGES: Record<Field, string> = {
  name: 'Escribe tu nombre.',
  phone: 'Revisa tu celular: son 9 números y empieza con 9.',
  businessName: 'El nombre de tu negocio es muy largo.',
  consent: 'Para anotarte, marca que aceptas.',
};

const SERVER_ERRORS = {
  rate_limited: 'Hiciste muchos intentos seguidos. Vuelve a intentarlo en unos minutos.',
  network: 'No pudimos enviar tus datos. Revisa tu conexión y vuelve a intentarlo.',
  server: 'Algo falló de nuestro lado. Vuelve a intentarlo en un momento.',
} as const;

const FIELD_ORDER: Field[] = ['name', 'phone', 'businessName', 'consent'];

function validate(values: { name: string; phone: string; businessName: string; consent: boolean }) {
  const errors: Errors = {};
  if (values.name.replace(/\s+/g, ' ').trim().length < 2) errors.name = MESSAGES.name;
  if (!normalizePeruMobile(values.phone)) errors.phone = MESSAGES.phone;
  if (values.businessName.trim().length > 80) errors.businessName = MESSAGES.businessName;
  if (!values.consent) errors.consent = MESSAGES.consent;
  return errors;
}

/** «+51 987 654 321» */
const prettyPhone = (e164: string) => e164.replace(/^\+51(\d{3})(\d{3})(\d{3})$/, '+51 $1 $2 $3');

export function Waitlist() {
  const [done, setDone] = useState<{ name: string; phone: string } | null>(null);

  return (
    <Section
      id="lista-de-espera"
      labelledBy="lista-title"
      className="bg-[linear-gradient(180deg,#efe7ff_0%,#f7f8fc_100%)]"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-8">
        <div className="rounded-[28px] border border-[#e1d4ff] bg-card p-6 shadow-[0_30px_60px_-40px_rgba(14,42,139,0.45)] sm:p-8">
          {done ? (
            <Success {...done} onAgain={() => setDone(null)} />
          ) : (
            <WaitlistForm onDone={setDone} />
          )}
        </div>
        <JuryQr />
      </div>
    </Section>
  );
}

function WaitlistForm({ onDone }: { onDone: (who: { name: string; phone: string }) => void }) {
  const [values, setValues] = useState({ name: '', phone: '', businessName: '', consent: false });
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();
  const idFor = (field: Field) => `${ids}-${field}`;

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((f) => errs[f]);
    const el = first && formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(idFor(first))}`);
    if (!el) return;
    // Center it: a plain focus() can leave the field under the sticky header.
    el.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }

  function update<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear a field's error as soon as she fixes it.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setServerError(null);
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirst(errs);
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          phone: values.phone,
          businessName: values.businessName.trim() || undefined,
          consent: true,
          consentVersion: WAITLIST_CONSENT_VERSION,
        }),
      });
      if (res.ok) {
        onDone({
          name: values.name.trim().split(/\s+/)[0] ?? '',
          phone: normalizePeruMobile(values.phone) ?? values.phone,
        });
        return;
      }
      if (res.status === 429) {
        setServerError(SERVER_ERRORS.rate_limited);
      } else if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { fields?: string[] } | null;
        const fromServer: Errors = {};
        for (const f of body?.fields ?? []) {
          if (FIELD_ORDER.includes(f as Field)) fromServer[f as Field] = MESSAGES[f as Field];
        }
        if (Object.keys(fromServer).length > 0) {
          setErrors(fromServer);
          focusFirst(fromServer);
        } else {
          setServerError(SERVER_ERRORS.server);
        }
      } else {
        setServerError(SERVER_ERRORS.server);
      }
    } catch {
      setServerError(SERVER_ERRORS.network);
    } finally {
      setSending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <Eyebrow>Lista de espera</Eyebrow>
      <h2
        id="lista-title"
        className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-navy sm:text-4xl"
      >
        Quiero probar ALZA
      </h2>
      <p className="mt-3 text-lg text-muted">
        Déjanos tus datos y te escribimos cuando abramos el piloto con bodegueras.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField
          id={idFor('name')}
          label="Tu nombre"
          autoComplete="name"
          value={values.name}
          maxLength={80}
          onChange={(v) => update('name', v)}
          error={errors.name}
        />
        <TextField
          id={idFor('phone')}
          label="Tu celular"
          autoComplete="tel-national"
          inputMode="tel"
          type="tel"
          placeholder="987 654 321"
          prefix="+51"
          value={values.phone}
          maxLength={20}
          onChange={(v) => update('phone', v)}
          error={errors.phone}
          hint="Solo para avisarte. No te mandaremos publicidad."
        />
        <div className="sm:col-span-2">
          <TextField
            id={idFor('businessName')}
            label={
              <>
                Nombre de tu negocio <span className="font-normal text-muted">(opcional)</span>
              </>
            }
            autoComplete="organization"
            placeholder="Por ejemplo: Bodega Sol"
            value={values.businessName}
            maxLength={80}
            onChange={(v) => update('businessName', v)}
            error={errors.businessName}
          />
        </div>
      </div>

      <div className="mt-6">
        <label
          htmlFor={idFor('consent')}
          className={`flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-4 transition-colors ${
            errors.consent
              ? 'border-danger bg-[#fef3f2]'
              : values.consent
                ? 'border-navy bg-blue-soft'
                : 'border-border bg-bg'
          }`}
        >
          <input
            id={idFor('consent')}
            type="checkbox"
            checked={values.consent}
            onChange={(e) => update('consent', e.target.checked)}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={`${idFor('consent')}-version${errors.consent ? ` ${idFor('consent')}-error` : ''}`}
            className="mt-0.5 size-6 shrink-0 cursor-pointer accent-purple"
          />
          <span className="text-[15px] leading-snug text-text">
            {WAITLIST_CONSENT_TEXT}{' '}
            <Link
              href="/privacidad"
              className="font-semibold text-purple underline underline-offset-2"
            >
              Ver privacidad
            </Link>
          </span>
        </label>
        <p id={`${idFor('consent')}-version`} className="mt-2 pl-1 text-sm text-muted">
          {WAITLIST_CONSENT_LABEL}
        </p>
        <FieldError id={`${idFor('consent')}-error`} message={errors.consent} />
      </div>

      {serverError && (
        <p
          role="alert"
          className="mt-6 flex gap-2 rounded-2xl border border-[#f4c7c3] bg-[#fef3f2] p-4 text-danger"
        >
          <AlertIcon className="mt-0.5 size-5 shrink-0" />
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className={`${BUTTON_PRIMARY} mt-6 w-full sm:w-auto sm:min-w-64 disabled:cursor-wait disabled:opacity-70`}
      >
        {sending ? 'Enviando…' : 'Quiero probar ALZA'}
      </button>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  prefix,
  type = 'text',
  ...rest
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  prefix?: string;
  type?: 'text' | 'tel';
  autoComplete?: string;
  inputMode?: 'text' | 'tel';
  placeholder?: string;
  maxLength?: number;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-semibold text-text">
        {label}
      </label>
      <div
        className={`flex min-h-[52px] items-stretch overflow-hidden rounded-2xl border bg-white transition-shadow focus-within:border-navy focus-within:ring-2 focus-within:ring-navy/20 ${
          error ? 'border-danger' : 'border-[#cfd6e4]'
        }`}
      >
        {prefix && (
          <span
            className="flex items-center border-r border-border bg-bg px-3.5 text-lg font-semibold text-muted"
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="w-full min-w-0 flex-1 bg-transparent px-4 text-lg text-text placeholder:text-[#94a3b8] focus:outline-none"
          {...rest}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-[15px] font-semibold text-danger">
      <AlertIcon className="size-4 shrink-0" />
      {message}
    </p>
  );
}

function Success({ name, phone, onAgain }: { name: string; phone: string; onAgain: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the confirmation so screen readers announce it.
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div role="status" className="flex flex-col items-start py-4">
      <span className="grid size-16 place-items-center rounded-full bg-[#e4f8f5] text-ok">
        <CheckIcon className="size-9 stroke-[2.5]" />
      </span>
      <h2
        ref={headingRef}
        tabIndex={-1}
        id="lista-title"
        className="mt-6 text-[30px] font-extrabold leading-tight text-navy focus:outline-none sm:text-4xl"
      >
        ¡Listo{name ? `, ${name}` : ''}! Ya estás en la lista.
      </h2>
      <p className="mt-3 text-lg text-muted">
        Te escribiremos al <b className="whitespace-nowrap text-text">{prettyPhone(phone)}</b>{' '}
        cuando abramos el piloto. Si quieres que borremos tus datos antes, solo pídelo.
      </p>
      <button
        type="button"
        onClick={onAgain}
        className="mt-6 inline-flex min-h-11 items-center font-semibold text-purple underline underline-offset-4"
      >
        Anotar a otra persona
      </button>
    </div>
  );
}
