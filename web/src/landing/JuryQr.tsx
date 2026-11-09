import { useEffect, useRef, useState } from 'react';
import { useInView } from './hooks';
import { QrIcon } from './icons';
import { demoWhatsAppNumber } from './phone';

/**
 * «Para el jurado» (D43): QR to the demo WhatsApp number. `qrcode-generator` loads only when this
 * block nears the screen. Without `VITE_ALZA_WHATSAPP_NUMBER` it shows «Muy pronto», never a
 * broken QR.
 */
const DEMO_NUMBER = demoWhatsAppNumber(import.meta.env.VITE_ALZA_WHATSAPP_NUMBER);
const WA_URL = DEMO_NUMBER ? `https://wa.me/${DEMO_NUMBER}?text=Hola%20ALZA` : null;

export function JuryQr() {
  return (
    <div className="flex h-full flex-col rounded-[28px] bg-navy p-6 text-white sm:p-7">
      <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#c9b6ff]">Para el jurado</p>
      <h3 className="mt-2 text-2xl font-extrabold">Pruébalo en vivo</h3>
      {WA_URL ? (
        <>
          <p className="mt-2 text-[#d6ddf5]">
            Escanea el código con la cámara y escríbele «Hola ALZA» por WhatsApp.
          </p>
          <div className="mt-6 flex flex-1 items-center justify-center">
            <QrCode value={WA_URL} />
          </div>
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-[52px] items-center justify-center rounded-full bg-white px-6 font-semibold text-navy transition-colors hover:bg-lav"
          >
            Abrir WhatsApp
          </a>
          <p className="mt-4 text-sm text-[#d6ddf5]">
            Funciona con los celulares registrados para la demo.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[#d6ddf5]">
            Aquí vas a poder escanear un código y escribirle a ALZA desde tu WhatsApp.
          </p>
          <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-white/25 px-6 py-10 text-center">
            <QrIcon className="size-12 text-[#c9b6ff]" />
            <p className="text-xl font-bold">Muy pronto</p>
            <p className="text-[15px] text-[#d6ddf5]">El número de la demo se activa en breve.</p>
          </div>
        </>
      )}
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
          aria-label="Código QR para escribirle a ALZA por WhatsApp"
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
