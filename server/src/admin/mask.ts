/**
 * RNF-09 / 14.4: the panel shows ids and counts, never a full phone. Peruvian mobiles keep the
 * country code and the last 3 digits («+51 ••• ••• 111»); anything else keeps 2 + 3 digits.
 */
export function maskPhone(phoneE164: string | null | undefined): string {
  const digits = (phoneE164 ?? '').replace(/\D/g, '');
  if (digits.length < 7) return '•••';
  const last = digits.slice(-3);
  if (digits.startsWith('51') && digits.length === 11) return `+51 ••• ••• ${last}`;
  return `+${digits.slice(0, 2)} ••• ${last}`;
}
