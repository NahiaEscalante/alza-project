/**
 * Close messages of the 12.1 catalog (Fase 5): WA-10 (the one close message), WA-11 (asking
 * again), WA-12 (confirmation with points), WA-18 (late reply), WA-21 (nothing recorded, D39) and
 * WA-22 (close already sent, D49). Pure functions: data in, text out. Amounts with `formatSoles`
 * (RNF-11). Never «ganancia».
 *
 * The flows (`flows/close`) are the only callers; nothing else may send these ids.
 */
import {
  type ClarificationType,
  type CloseLevel,
  formatSoles,
  type UnitemizedCashNotice,
  type WeeklyComparison,
} from '../domain/index.js';

export const CLOSE_CATALOG = {
  close: 'WA-10',
  clarify: 'WA-11',
  confirm: 'WA-12',
  late: 'WA-18',
  nothingRecorded: 'WA-21',
  alreadySent: 'WA-22',
} as const;
export type CloseCatalogId = (typeof CLOSE_CATALOG)[keyof typeof CLOSE_CATALOG];

/** 1️⃣ … 6️⃣: at most 5 doubts plus the cash question (PR08). */
export const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'] as const;

export function numberEmoji(n: number): string {
  return NUMBER_EMOJI[n - 1] ?? `${n}.`;
}

// ---------------------------------------------------------------------------
// WA-10 informative lines (RF-CI-11, D27): before the doubts, never counted among the 5.
// ---------------------------------------------------------------------------

/** PR09 (11.5). */
export function unitemizedCashLine(notice: UnitemizedCashNotice): string {
  return `Ojo: anotaste ${formatSoles(notice.recordedCents)} en efectivo pero dijiste que vendiste ${formatSoles(notice.declaredCents)}. Registré ${formatSoles(notice.addedCents)} más. Si no es así, dímelo en tu respuesta.`;
}

/** PR03 (11.1): `day` is «lunes 9». */
export function afterCloseLine(amountCents: number, day: string): string {
  return `Agregaste ${formatSoles(amountCents)} al ${day} después de su cierre.`;
}

/** D40 (11.5). */
export function digitalShortfallLine(missingCents: number): string {
  return `Faltan ${formatSoles(missingCents)} en capturas. Si quieres, manda tu lista de movimientos.`;
}

/** D27, case 27: first close after she chose «solo texto». */
export const TEXT_ONLY_LINE =
  'Desde hoy tu resumen va solo en texto. Para volver a la imagen, escribe “con imagen”.';

// ---------------------------------------------------------------------------
// WA-10
// ---------------------------------------------------------------------------

/** `resumen` of 10.3 (Indicators, 11.6). */
export interface CloseSummaryFigures {
  inCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  /** «Es todo el día» differences (11.5): shown only when there are. */
  unknownMethodSalesCents: number;
  outCents: number;
  inventoryCents: number;
  expensesCents: number;
  householdCents: number;
  unclassifiedCents: number;
}

/** Sunday block (11.11, D38, D60). */
export interface CloseWeekBlock {
  inCents: number;
  outCents: number;
  leftCents: number;
  completeCount: number;
  comparison: WeeklyComparison;
}

export interface CloseMessageDoubt {
  type: ClarificationType;
  /** The question (11.8 suggested texts, `describeClarification`). */
  text: string;
}

export interface CloseMessageInput {
  /** «martes 10». */
  dayLabel: string;
  summary: CloseSummaryFigures;
  /** Already rendered informative lines, in order. */
  notices: readonly string[];
  /** Numbered 1…n in this order. */
  doubts: readonly CloseMessageDoubt[];
  /** «Tu caja debería tener S/ 84 más que en la mañana. ¿Cuadra?» (always last, PR08). */
  cashQuestion: string;
  /** «Tienes {k} cosas más por revisar en la web» (0 hides it). */
  webCount: number;
  week: CloseWeekBlock | null;
  /** 7-day link (D13). */
  link: string;
}

function inLine(s: CloseSummaryFigures): string {
  const parts = [
    `Yape y Plin ${formatSoles(s.digitalSalesCents)}`,
    `efectivo ${formatSoles(s.cashSalesCents)}`,
  ];
  if (s.unknownMethodSalesCents > 0)
    parts.push(`sin detalle ${formatSoles(s.unknownMethodSalesCents)}`);
  return `Entró: ${formatSoles(s.inCents)} (${parts.join(', ')})`;
}

function outLine(s: CloseSummaryFigures): string {
  const parts = (
    [
      ['mercadería', s.inventoryCents],
      ['gastos', s.expensesCents],
      ['casa', s.householdCents],
      ['por clasificar', s.unclassifiedCents],
    ] as const
  )
    .filter(([, cents]) => cents > 0)
    .map(([label, cents]) => `${label} ${formatSoles(cents)}`);
  const total = `Salió: ${formatSoles(s.outCents)}`;
  return parts.length > 0 ? `${total} (${parts.join(', ')})` : total;
}

/** How she could answer each point, for the example line («1 son 12 soles, 2 solo efectivo»). */
const EXAMPLE_ANSWER: Record<ClarificationType, string> = {
  unreadable: 'son 12 soles',
  ambiguous_total: 'solo efectivo',
  possible_duplicate: 'fueron dos',
  direction: 'me pagaron',
  date: 'sí',
  category: 'mercadería',
  missing_from_list: 'sí',
};

/** «Respóndeme en un solo mensaje o audio, por ejemplo: «1 son 12 soles, 2 solo efectivo, 3 sí».» */
export function replyExampleLine(doubts: readonly Pick<CloseMessageDoubt, 'type'>[]): string {
  if (doubts.length === 0) {
    return 'Respóndeme en un solo mensaje o audio, por ejemplo: «sí» o «no, saqué 20 para la casa».';
  }
  const parts = doubts.map((doubt, i) => `${i + 1} ${EXAMPLE_ANSWER[doubt.type]}`);
  parts.push(`${doubts.length + 1} sí`);
  return `Respóndeme en un solo mensaje o audio, por ejemplo: «${parts.join(', ')}».`;
}

export function webCountLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? 'Tienes 1 cosa más por revisar en la web.'
    : `Tienes ${count} cosas más por revisar en la web.`;
}

export function weekBlockLines(week: CloseWeekBlock): string[] {
  const closes =
    week.completeCount === 1 ? '1 cierre completo' : `${week.completeCount} cierres completos`;
  const lines = [
    `📅 Tu semana: entró ${formatSoles(week.inCents)}, salió ${formatSoles(week.outCents)}, te quedó ${formatSoles(week.leftCents)}, ${closes}.`,
  ];
  const c = week.comparison;
  if (c.comparable) {
    const delta = c.leftDeltaCents;
    lines.push(
      delta === 0
        ? 'Te quedó lo mismo que la semana pasada.'
        : `Te quedó ${formatSoles(Math.abs(delta))} ${delta > 0 ? 'más' : 'menos'} que la semana pasada.`,
    );
  } else {
    lines.push(`${c.text}.`);
  }
  return lines;
}

/** WA-10, exactly as 12.1 lays it out (variante sin dudas, variante domingo). */
export function closeMessageText(input: CloseMessageInput): string {
  const head = [
    `📒 Tu cierre del ${input.dayLabel}`,
    inLine(input.summary),
    outLine(input.summary),
  ];
  head.push(...input.notices);

  const questions: string[] = [];
  if (input.doubts.length === 0) {
    questions.push(input.cashQuestion);
  } else {
    questions.push(`Tengo ${input.doubts.length + 1} dudas:`);
    input.doubts.forEach((doubt, i) => {
      questions.push(`${numberEmoji(i + 1)} ${doubt.text}`);
    });
    questions.push(`${numberEmoji(input.doubts.length + 1)} ${input.cashQuestion}`);
  }

  const tail = [replyExampleLine(input.doubts)];
  const web = webCountLine(input.webCount);
  if (web) tail.push(web);

  const blocks = [head.join('\n'), questions.join('\n'), tail.join('\n')];
  const link = `Ver todo (vale 7 días): ${input.link}`;
  if (input.week) blocks.push([...weekBlockLines(input.week), link].join('\n'));
  else blocks[blocks.length - 1] = `${blocks[blocks.length - 1]}\n${link}`;
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// WA-11, WA-12, WA-18, WA-21, WA-22
// ---------------------------------------------------------------------------

/** «Tu caja debería…» → «tu caja debería…» after a colon. */
function afterColon(text: string): string {
  const first = text.charAt(0);
  return first === first.toLocaleLowerCase('es')
    ? text
    : first.toLocaleLowerCase('es') + text.slice(1);
}

/**
 * WA-11 «No entendí el punto {n}: {pregunta}. ¿Me lo dices de nuevo?». Several points go in the
 * same message (one round, RF-CI-07), each with its number.
 */
export function clarifyText(points: readonly { number: number; question: string }[]): string {
  if (points.length === 0) throw new RangeError('WA-11 needs at least one point');
  if (points.length === 1) {
    const [p] = points as [{ number: number; question: string }];
    const question = p.question.trim();
    const end = /[?.!]$/.test(question) ? '' : '.';
    return `No entendí el punto ${p.number}: ${afterColon(question)}${end} ¿Me lo dices de nuevo?`;
  }
  const numbers = points.map((p) => p.number);
  const list = `${numbers.slice(0, -1).join(', ')} y ${numbers.at(-1)}`;
  const lines = points.map((p) => `${numberEmoji(p.number)} ${p.question.trim()}`);
  return [`No entendí los puntos ${list}:`, ...lines, '¿Me los dices de nuevo?'].join('\n');
}

export interface ConfirmationInput {
  /** «martes». */
  weekday: string;
  level: Exclude<CloseLevel, 'no_close'>;
  /** Provisional points of the day (13.1), awarded at 12:00 of the next day. */
  points: number;
  /** Balance including `points`. */
  balance: number;
  nextReward: { name: string; missingPoints: number } | null;
  /** 11.10: incoming list rows still unregistered (web-only doubts). */
  missingFromListCount: number;
}

const LEVEL_WORD: Record<Exclude<CloseLevel, 'no_close'>, string> = {
  complete: 'completo',
  partial: 'a medias',
};

function rewardName(name: string): string {
  return afterColon(name.trim());
}

/** WA-12. */
export function confirmationText(input: ConfirmationInput): string {
  const day = input.weekday.charAt(0).toLocaleUpperCase('es') + input.weekday.slice(1);
  const lines = [`✅ ${day} cerrado ${LEVEL_WORD[input.level]}.`];
  let points = `+${input.points} ⭐ · Tienes ${input.balance}.`;
  if (input.nextReward) {
    points += ` Te faltan ${input.nextReward.missingPoints} para ${rewardName(input.nextReward.name)}.`;
  }
  lines.push(points);
  const k = input.missingFromListCount;
  if (k > 0) {
    lines.push(
      k === 1
        ? 'Encontré 1 cobro sin registrar en tu lista: revísalo en la web.'
        : `Encontré ${k} cobros sin registrar en tu lista: revísalos en la web.`,
    );
  }
  return lines.join('\n');
}

/** WA-18 (case 20). */
export const LATE_REPLY_TEXT = 'Lo anoté. Como pasó la hora, ya no suma puntos.';

/** WA-21 (D39, case 34). */
export const NOTHING_RECORDED_TEXT =
  'Hoy todavía no tengo nada anotado. Cuando me mandes tus capturas o ventas, te armo tu cierre.';

/** WA-22 (D49, D54, case 18). */
export const ALREADY_SENT_TEXT = 'Tu cierre de hoy está más arriba 👆';
