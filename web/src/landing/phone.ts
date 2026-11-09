/**
 * Peru mobile check for instant feedback in the form. The server normalizes again
 * (`normalizePeruMobile` in `server/src/http/routes/waitlist.ts`); keep both in sync.
 */
export function normalizePeruMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 11 && digits.startsWith('51')) digits = digits.slice(2);
  return /^9\d{8}$/.test(digits) ? `+51${digits}` : null;
}

/**
 * Demo WhatsApp number from `VITE_ALZA_WHATSAPP_NUMBER` (international format, `+` and spaces
 * allowed). Null when unset or malformed, so the landing shows «Muy pronto» instead of a bad QR.
 */
export function demoWhatsAppNumber(raw: string | undefined): string | null {
  const digits = raw?.replace(/[\s\-+()]/g, '') ?? '';
  return /^\d{8,15}$/.test(digits) ? digits : null;
}
