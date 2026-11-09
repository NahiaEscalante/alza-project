import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AlzaLogo } from '../components/AlzaLogo';
import { useInView, usePageVisible, usePrefersReducedMotion } from './hooks';
import { DoubleCheck } from './icons';
import { soles } from './ui';

/**
 * Animated WhatsApp mock for the hero (spec 4.2, «un día de Marta»): captures and an audio during
 * the day with the blue double check and no answer, then the single closing message (WA-10) at
 * 21:00, her one reply and the confirmation (WA-12). Pure React + CSS. It pauses off screen and in
 * hidden tabs, and shows the final frame without motion for prefers-reduced-motion.
 *
 * Decorative for assistive tech (aria-hidden): the hero carries a text description.
 * Sample amounts follow spec 10.3.
 */

type Side = 'out' | 'in';

type Item =
  | { kind: 'msg'; id: string; at: number; side: Side; time: string; body: ReactNode }
  | { kind: 'typing'; id: string; at: number; until: number }
  | { kind: 'chip'; id: string; at: number; text: string };

const TIMELINE: Item[] = [
  { kind: 'chip', id: 'today', at: 0, text: 'HOY' },
  {
    kind: 'msg',
    id: 'yape-in',
    at: 400,
    side: 'out',
    time: '10:42',
    body: <CaptureThumb title="¡Te Yapearon!" amount="12.50" who="Ana T." />,
  },
  { kind: 'msg', id: 'audio', at: 2300, side: 'out', time: '12:15', body: <AudioNote /> },
  {
    kind: 'msg',
    id: 'yape-out',
    at: 3900,
    side: 'out',
    time: '14:05',
    body: <CaptureThumb title="¡Yapeaste!" amount="150" who="Distribuidora" />,
  },
  { kind: 'chip', id: 'silence', at: 5300, text: 'ALZA anota en silencio y no te interrumpe' },
  { kind: 'typing', id: 'typing-1', at: 7000, until: 8200 },
  { kind: 'msg', id: 'close', at: 8200, side: 'in', time: '21:00', body: <ClosingMessage /> },
  {
    kind: 'msg',
    id: 'reply',
    at: 11800,
    side: 'out',
    time: '21:03',
    body: <p>La 1 eran 12 soles, la 2 solo efectivo y la caja sí cuadra 👍</p>,
  },
  { kind: 'typing', id: 'typing-2', at: 12800, until: 13800 },
  {
    kind: 'msg',
    id: 'done',
    at: 13800,
    side: 'in',
    time: '21:04',
    body: (
      <p>
        ✅ <b>Martes cerrado completo.</b>
        <br />
        +10 ⭐ · Tienes 340. Te faltan 60 para tu kit escolar.
      </p>
    ),
  },
];

const BADGE_AT = 14300;
const FADE_AT = 20000;
const LOOP_AT = 20600;
/** Status bar clock, by time in the loop. */
const CLOCK: Array<[number, string]> = [
  [0, '10:42'],
  [2300, '12:15'],
  [3900, '14:05'],
  [7000, '21:00'],
  [11800, '21:03'],
  [13800, '21:04'],
];
/** Captions under the phone: what is happening in the story. */
const PHASES: Array<{ at: number; title: string; text: string }> = [
  { at: 0, title: 'Durante el día', text: 'Mandas capturas y audios. ALZA anota sin responderte.' },
  { at: 7000, title: 'A las 9 de la noche', text: 'Te llega un solo mensaje con tu cierre.' },
  {
    at: 11800,
    title: 'Respondes una vez',
    text: 'Aclaras sus dudas en un mensaje y sumas puntos.',
  },
];

const EVENTS = [
  ...new Set([
    ...TIMELINE.flatMap((item) => (item.kind === 'typing' ? [item.at, item.until] : [item.at])),
    ...CLOCK.map(([at]) => at),
    ...PHASES.map((p) => p.at),
    BADGE_AT,
    FADE_AT,
    LOOP_AT,
  ]),
].sort((a, b) => a - b);

const latest = <T,>(list: Array<[number, T]>, t: number): T => {
  let value = list[0]?.[1] as T;
  for (const [at, v] of list) if (at <= t) value = v;
  return value;
};

export function ChatDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onScreen = useInView(frameRef);
  const pageVisible = usePageVisible();
  const [t, setT] = useState(0);
  const running = onScreen && pageVisible && !reduced;
  // Reduced motion: a still of the end of the day (the close, her reply and the confirmation).
  const now = reduced ? FADE_AT - 1 : t;

  useEffect(() => {
    if (!running) return;
    const next = EVENTS.find((at) => at > t);
    if (next === undefined) {
      setT(0);
      return;
    }
    const id = window.setTimeout(() => setT(next >= LOOP_AT ? 0 : next), next - t);
    return () => window.clearTimeout(id);
  }, [running, t]);

  const visible = TIMELINE.filter(
    (item) => item.at <= now && (item.kind !== 'typing' || now < item.until),
  );
  const typing = visible.some((item) => item.kind === 'typing');
  const phaseIndex = PHASES.reduce((idx, p, i) => (p.at <= now ? i : idx), 0);
  const phase = PHASES[phaseIndex] ?? PHASES[0];
  const night = now >= 7000;

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      <div
        ref={frameRef}
        aria-hidden="true"
        className="relative mx-auto h-[600px] w-[300px] rounded-[46px] bg-[#10172f] p-[10px] shadow-[0_40px_80px_-30px_rgba(14,42,139,0.55),0_0_0_1px_rgba(255,255,255,0.06)_inset] sm:h-[640px] sm:w-[320px]"
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-[36px] bg-white">
          {/* Status bar */}
          <div className="flex h-8 shrink-0 items-center justify-between bg-white px-6 pt-1 text-[12px] font-semibold text-[#10172f]">
            <span className="tabular-nums">{latest(CLOCK, now)}</span>
            <span className="absolute left-1/2 top-2 h-[18px] w-[76px] -translate-x-1/2 rounded-full bg-[#10172f]" />
            <span className="flex items-center gap-1">
              <SignalGlyph />
              <BatteryGlyph />
            </span>
          </div>

          {/* Chat header */}
          <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[#e9edef] bg-white px-3">
            <svg viewBox="0 0 24 24" className="size-5 text-[#54656f]" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="grid size-9 place-items-center rounded-full bg-lav-soft">
              <AlzaLogo wordmark={false} size={20} />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[15px] font-semibold text-[#111b21]">ALZA</span>
              <span className="text-[12px] text-[#667781]">
                {typing ? 'escribiendo…' : 'en línea'}
              </span>
            </span>
          </div>

          {/* Messages: bottom-aligned, so older ones scroll out of the top like a real chat. */}
          <div
            className={`wa-wallpaper relative flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden px-2.5 pb-2 pt-3 transition-opacity duration-500 ${now >= FADE_AT ? 'opacity-0' : 'opacity-100'}`}
          >
            {visible.map((item) => (
              <ChatRow key={item.id} item={item} />
            ))}
          </div>

          {/* Input bar */}
          <div className="flex h-14 shrink-0 items-center gap-2 bg-[#f0f2f5] px-2.5">
            <span className="flex h-10 flex-1 items-center rounded-full bg-white px-4 text-[14px] text-[#8696a0]">
              Mensaje
            </span>
            <span className="grid size-10 place-items-center rounded-full bg-[#00a884] text-white">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path
                  d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Points badge when the day is closed */}
      {now >= BADGE_AT && now < FADE_AT && (
        <div
          aria-hidden="true"
          className="lp-badge-pop absolute -right-1 top-28 rounded-2xl border border-[#bfede6] bg-[#e4f8f5] px-3 py-2 text-[15px] font-bold text-navy shadow-[0_12px_24px_-12px_rgba(14,42,139,0.45)] sm:-right-6"
        >
          +10 ⭐
        </div>
      )}

      {/* Story caption: also readable text, the phone itself is aria-hidden. */}
      <div className="mx-auto mt-6 flex max-w-[320px] items-start gap-3">
        <span
          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-[18px] ${night ? 'bg-navy text-white' : 'bg-[#fff4dc] text-[#b45309]'}`}
          aria-hidden="true"
        >
          {night ? '☾' : '☀'}
        </span>
        <p className="min-h-[3em] text-[15px] leading-snug text-muted" aria-hidden="true">
          <b className="block text-text">{phase?.title}</b>
          {phase?.text}
        </p>
      </div>
      <ol className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
        {PHASES.map((p, i) => (
          <li
            key={p.at}
            className={`h-1.5 rounded-full transition-all duration-500 ${i === phaseIndex ? 'w-6 bg-purple' : 'w-1.5 bg-[#cdd3e1]'}`}
          />
        ))}
      </ol>
    </div>
  );
}

function ChatRow({ item }: { item: Item }) {
  if (item.kind === 'chip') {
    return (
      <div className="wa-row">
        <div className="flex justify-center py-1">
          <span className="wa-pop wa-bubble rounded-lg bg-[#ffffffe6] px-2.5 py-1 text-center text-[11.5px] font-medium text-[#54656f]">
            {item.text}
          </span>
        </div>
      </div>
    );
  }
  if (item.kind === 'typing') {
    return (
      <div className="wa-row">
        <div className="flex">
          <span className="wa-pop wa-bubble wa-typing flex items-center gap-1 rounded-lg rounded-tl-sm bg-white px-3.5 py-3">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }
  const out = item.side === 'out';
  return (
    <div className="wa-row">
      <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`wa-pop wa-bubble max-w-[86%] rounded-lg px-2 pb-1 pt-1.5 text-[13px] leading-[1.38] text-[#111b21] ${out ? 'rounded-tr-sm bg-[#d9fdd3]' : 'rounded-tl-sm bg-white'}`}
        >
          {item.body}
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-[#667781]">
            {item.time}
            {out && <DoubleCheck className="wa-ticks h-[11px] w-4" />}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Thumbnail of a Yape-style receipt screen (drawn, not a real capture). */
function CaptureThumb({ title, amount, who }: { title: string; amount: string; who: string }) {
  return (
    <div className="w-[150px] overflow-hidden rounded-md bg-gradient-to-b from-[#7a1f8f] to-[#5b0f7a] px-3 pb-3 pt-2.5 text-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="h-1.5 w-8 rounded-full bg-white/35" />
        <span className="size-3 rounded-full bg-[#00ccb4]" />
      </div>
      <p className="text-[11px] font-semibold opacity-90">{title}</p>
      <p className="text-[22px] font-extrabold leading-tight tabular-nums">{soles(amount)}</p>
      <p className="truncate text-[10.5px] opacity-80">{who}</p>
      <div className="mt-2 flex gap-1">
        <span className="h-1 w-10 rounded-full bg-white/30" />
        <span className="h-1 w-6 rounded-full bg-white/20" />
      </div>
    </div>
  );
}

function AudioNote() {
  const bars = [6, 12, 9, 16, 11, 7, 14, 18, 10, 6, 13, 9, 15, 8, 5, 11, 7, 4];
  return (
    <div className="flex w-[186px] items-center gap-2 py-1">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e9ddff] text-purple">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </span>
      <span className="wa-wave flex h-5 flex-1 items-center gap-[2px]">
        {bars.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars
          <i key={i} style={{ height: `${h}px` }} />
        ))}
      </span>
      <span className="text-[11px] tabular-nums text-[#667781]">0:04</span>
    </div>
  );
}

/** WA-10 with the summary image (8.6) on top and the caption text below. */
function ClosingMessage() {
  return (
    <div className="w-[226px]">
      <div className="mb-1.5 overflow-hidden rounded-md bg-gradient-to-br from-[#7b3ff2] via-[#4b1bb8] to-[#3a1296] p-3 text-white">
        <div className="flex items-center justify-between text-[11px] font-semibold opacity-90">
          <span>Martes 10 nov</span>
          <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px]">ALZA</span>
        </div>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 text-[12px] tabular-nums">
          <dt className="opacity-85">Entró</dt>
          <dd className="font-semibold">{soles('412')}</dd>
          <dt className="opacity-85">Salió</dt>
          <dd className="font-semibold">{soles('180')}</dd>
        </dl>
        <div className="mt-2 flex items-end justify-between border-t border-white/25 pt-1.5">
          <span className="text-[12px] opacity-90">Te quedó</span>
          <span className="text-[22px] font-extrabold leading-none tabular-nums">
            {soles('232')}
          </span>
        </div>
      </div>
      <p>
        📒 <b>Tu cierre del martes</b>
        <br />
        Entró: {soles('412')} (Yape y Plin {soles('298')}, efectivo {soles('114')})
        <br />
        Salió: {soles('180')} (mercadería {soles('150')}, casa {soles('30')})
      </p>
      <p className="mt-1.5">Tengo 3 dudas:</p>
      <ol className="space-y-0.5">
        <li>1️⃣ Una captura de las 11:42 a. m. no se lee bien. ¿De cuánto era?</li>
        <li>2️⃣ Dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo?</li>
        <li>3️⃣ Tu caja debería tener {soles('84')} más que en la mañana. ¿Cuadra?</li>
      </ol>
      <p className="mt-1.5">Respóndeme en un solo mensaje o audio.</p>
      <p className="text-[#027eb5]">Ver todo (vale 7 días)</p>
    </div>
  );
}

function SignalGlyph() {
  return (
    <svg viewBox="0 0 18 12" className="h-3 w-[18px]" aria-hidden="true" fill="currentColor">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <svg viewBox="0 0 26 12" className="h-3 w-[26px]" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="22"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        opacity=".45"
      />
      <rect x="2" y="2" width="16" height="8" rx="1.5" fill="currentColor" />
      <rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".45" />
    </svg>
  );
}
