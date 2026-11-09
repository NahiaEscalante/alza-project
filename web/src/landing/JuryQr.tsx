import { useEffect, useRef, useState } from 'react';
import { useInView } from './hooks';
import { demoTelegramBot } from './phone';

/**
 * Public demo block (D71): «Pruébalo hoy en Telegram», with a QR to the bot's deep link
 * (`https://t.me/<bot>?start=landing`). WhatsApp stays the product vision in the rest of the
 * landing; the public demo runs on Telegram while Meta's account is blocked. The bot comes from
 * `VITE_ALZA_TELEGRAM_BOT` (default `alzaagentbot`). `qrcode-generator` loads only when this
 * block nears the screen.
 */
const BOT = demoTelegramBot(import.meta.env.VITE_ALZA_TELEGRAM_BOT);
const TELEGRAM_URL = `https://t.me/${BOT}?start=landing`;

export function JuryQr() {
  return (
    <div className="flex h-full flex-col rounded-[28px] bg-navy p-6 text-white sm:p-7">
      <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#c9b6ff]">Demo abierta</p>
      <h3 className="mt-2 text-2xl font-extrabold">Pruébalo hoy en Telegram</h3>
      <p className="mt-2 text-[#d6ddf5]">
        Escanea el código con la cámara de tu celular, abre el chat de ALZA en Telegram y toca
        «Iniciar». Te pedirá tu número para crear tu cuenta.
      </p>
      <div className="mt-6 flex flex-1 items-center justify-center">
        <QrCode value={TELEGRAM_URL} />
      </div>
      <a
        href={TELEGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex min-h-[52px] items-center justify-center rounded-full bg-white px-6 font-semibold text-navy transition-colors hover:bg-lav"
      >
        Abrir en Telegram
      </a>
      <p className="mt-4 text-sm text-[#d6ddf5]">
        Es una demo: usa capturas y datos de prueba, no los reales de tu negocio. ALZA está pensado
        para WhatsApp; mientras tanto, la demo funciona en Telegram.
      </p>
    </div>
  );
}

function QrCode({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '400px 0px' });
  const [path, setPath] = useState<{ d: string; size: number } | null>(null);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    import('qrcode-generator').then(({ default: qrcode }) => {
      if (cancelled) return;
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const count = qr.getModuleCount();
      let d = '';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
        }
      }
      setPath({ d, size: count });
    });
    return () => {
      cancelled = true;
    };
  }, [near, value]);

  return (
    <div
      ref={ref}
      className="grid size-[216px] place-items-center rounded-[20px] bg-white p-4 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)]"
    >
      {path ? (
        <svg
          viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`}
          role="img"
          aria-label="Código QR para abrir ALZA en Telegram"
          className="size-full"
          shapeRendering="crispEdges"
        >
          <path d={path.d} fill="#10172f" />
        </svg>
      ) : (
        <span className="size-full animate-pulse rounded-xl bg-[#eef2f8]" aria-hidden="true" />
      )}
    </div>
  );
}
