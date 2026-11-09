// Build-time variables read by the landing (merged into Vite's ImportMetaEnv).
interface ImportMetaEnv {
  /** D71: Telegram bot of the public demo QR (default `alzaagentbot`). Optional. */
  readonly VITE_ALZA_TELEGRAM_BOT?: string;
}
