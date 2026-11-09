import { demoTelegramBot } from './phone';

/**
 * Public demo block (D71): «Pruébalo hoy en Telegram», with the official Telegram QR of the bot
 * (`web/public/qr-telegram.webp`, cropped from `imgs/qr-code.jpg`) and a deep link
 * (`https://t.me/<bot>?start=landing`). WhatsApp stays the product vision in the rest of the
 * landing; the public demo runs on Telegram while Meta's account is blocked. The bot comes from
 * `VITE_ALZA_TELEGRAM_BOT` (default `alzaagentbot`). Without the eyebrow and the note under the
 * button (D77); the bot itself still warns it is a demo (WA-01, D74).
 */
const BOT = demoTelegramBot(import.meta.env.VITE_ALZA_TELEGRAM_BOT);
const TELEGRAM_URL = `https://t.me/${BOT}?start=landing`;

export function JuryQr() {
  return (
    <div className="flex h-full flex-col rounded-[28px] bg-navy p-6 text-white sm:p-7">
      <h3 className="text-2xl font-extrabold">Pruébalo hoy en Telegram</h3>
      <p className="mt-2 text-[#d6ddf5]">
        Escanea el código con la cámara de tu celular, abre el chat de ALZA en Telegram y toca
        «Iniciar». Te pedirá tu número para crear tu cuenta.
      </p>
      <div className="mt-6 flex flex-1 items-center justify-center">
        <div className="w-[232px] overflow-hidden rounded-[24px] bg-white p-3 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)]">
          <img
            src="/qr-telegram.webp"
            width={480}
            height={513}
            loading="lazy"
            decoding="async"
            alt={`Código QR para abrir @${BOT} en Telegram`}
            className="block h-auto w-full"
          />
        </div>
      </div>
      <a
        href={TELEGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex min-h-[52px] items-center justify-center rounded-full bg-white px-6 font-semibold text-navy transition-colors hover:bg-lav"
      >
        Abrir en Telegram
      </a>
    </div>
  );
}
