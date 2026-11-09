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

/** D71: the public demo bot. */
export const DEFAULT_TELEGRAM_BOT = 'alzaagentbot';

/**
 * Demo Telegram bot username from `VITE_ALZA_TELEGRAM_BOT` (with or without «@»). Falls back to
 * `alzaagentbot` when unset or malformed, so the QR never points to a broken link.
 */
export function demoTelegramBot(raw: string | undefined): string {
  const name = raw?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : DEFAULT_TELEGRAM_BOT;
}
