// Build-time variables read by the landing (merged into Vite's ImportMetaEnv).
interface ImportMetaEnv {
  /** Demo WhatsApp number for the jury QR, international format (e.g. 51987654321). Optional. */
  readonly VITE_ALZA_WHATSAPP_NUMBER?: string;
}
