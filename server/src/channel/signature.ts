import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta webhook signature (14.5, RF-IN-01): `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256
 * of the raw body with the app secret.
 */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * Secret the simulator signs with when no Meta app secret is configured (development only:
 * the webhook accepts it only while the simulator is enabled). Not a secret by design.
 */
export const SIMULATOR_APP_SECRET = 'alza-simulator-dev-secret';

export function signPayload(rawBody: string | Uint8Array, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function isValidSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signPayload(rawBody, secret).toLowerCase());
  const given = Buffer.from(header.toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}
