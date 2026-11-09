/**
 * Waitlist consent line (D52, 14.1): shown next to the form; its version is stored with the
 * signup. If the text changes in a relevant way, bump the version here and add it to
 * `WAITLIST_CONSENT_VERSIONS` in `server/src/http/routes/waitlist.ts`.
 */
export const WAITLIST_CONSENT_VERSION = 'waitlist-v1';

/** Shown under the checkbox so the visitor knows which text she accepted. */
export const WAITLIST_CONSENT_LABEL = 'Texto de consentimiento v1 · 8 nov 2026';

export const WAITLIST_CONSENT_TEXT =
  'Acepto que ALZA guarde mi nombre, mi celular y el nombre de mi negocio solo para avisarme cuando pueda probarlo. Se guardan hasta 6 meses o hasta que me inviten, y puedo pedir que los borren cuando quiera.';
