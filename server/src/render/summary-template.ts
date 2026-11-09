/**
 * Summary image template (8.6, insumos 9.1): fixed slots for the day, entró, salió, te quedó, por
 * confirmar, points and the week. Laid out at 360 logical px (RNF-12) and rasterized at 2×.
 *
 * Rules kept here: no emojis (icons are drawn), no client names and no doubts (the input has
 * neither), never the word «ganancia», the business name cut with «…», and every amount from
 * S/ 0 to S/ 99 999,99 fits its slot (the font shrinks when it has to).
 */
import {
  formatSoles,
  isoWeekday,
  MILESTONES,
  NO_COMPARISON_TEXT,
  type WeeklyComparison,
} from '../domain/index.js';
import { LEVEL_TEXT, longDayLabel, weekLabel } from '../ledger/labels.js';
import { COLORS, HEADER_GRADIENT } from './brand.js';
import { box, type Element, h, type Style, text } from './element.js';
import { type FontWeight, fitFontSize } from './fonts.js';
import { capitalize, formatPoints, plural, truncate } from './format.js';
import { calendarIcon, inIcon, logoMark, outIcon, pendingIcon, starIcon } from './icons.js';
import type {
  SummaryFigures,
  SummaryImageData,
  SummaryPoints,
  SummaryWeek,
} from './summary-types.js';

/** Logical width (RNF-12: legible on a 360 px screen). */
export const IMAGE_WIDTH = 360;
/** Raster scale: the PNG is 720 px wide. */
export const IMAGE_SCALE = 2;

const PAD = 16;
const CARD_PAD = 16;
/** Content width inside a card. */
const INNER = IMAGE_WIDTH - 2 * PAD - 2 * CARD_PAD;
const BUSINESS_NAME_MAX = 34;

const WARN_TEXT = '#8A3B06';
const ZERO = '#94A3B8';
const MARKER_BORDER = '#B8C2D6';

/** Anexo A: «Por confirmar: tenemos una duda; todavía no lo sumamos». */
export const PENDING_HINT = 'Tenemos una duda; todavía no lo sumamos.';
/** Anexo A: «Te quedó: entró menos salió». */
export const LEFT_HINT = 'Entró menos salió';
const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function summaryTemplate(data: SummaryImageData): Element {
  const pending = data.summary.pendingCents ?? 0;
  return box(
    {
      flexDirection: 'column',
      width: IMAGE_WIDTH,
      backgroundColor: COLORS.bg,
      fontFamily: 'Inter',
      color: COLORS.text,
    },
    header(data),
    box(
      { flexDirection: 'column', padding: `0 ${PAD}px 20px`, marginTop: -30 },
      figuresCard(data.summary),
      pending > 0 && pendingLine(pending),
      pointsCard(data.points),
      data.week && weekCard(data.week, data.businessDay),
    ),
  );
}

// ---------------------------------------------------------------------------
// Header: brand, day and business
// ---------------------------------------------------------------------------

/**
 * «Miércoles 28 de septiembre» is the widest title (13.7 em in Inter ExtraBold, ≤ 0.56 em per
 * character for every day of the year): one line, 24 px or a bit less.
 */
function dayTitleSize(title: string): number {
  return Math.min(24, Math.floor((IMAGE_WIDTH - 48) / ([...title].length * 0.56)));
}

function header(data: SummaryImageData): Element {
  const name = data.businessName?.trim();
  const title = capitalize(longDayLabel(data.businessDay));
  return box(
    {
      flexDirection: 'column',
      backgroundImage: HEADER_GRADIENT,
      padding: '18px 20px 48px',
      color: COLORS.card,
    },
    box(
      { alignItems: 'center', justifyContent: 'space-between' },
      box(
        { alignItems: 'center' },
        box(
          {
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: COLORS.card,
            alignItems: 'center',
            justifyContent: 'center',
          },
          logoMark(22),
        ),
        text({ marginLeft: 8, fontSize: 17, fontWeight: 800, letterSpacing: 0.6 }, 'ALZA'),
      ),
      text(
        {
          fontSize: 12,
          fontWeight: 600,
          padding: '5px 11px',
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.16)',
        },
        'Tu cierre del día',
      ),
    ),
    text(
      {
        marginTop: 18,
        fontSize: dayTitleSize(title),
        fontWeight: 800,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      },
      title,
    ),
    name &&
      h(
        'div',
        {
          style: {
            display: 'block',
            marginTop: 3,
            maxWidth: IMAGE_WIDTH - 40,
            fontSize: 15,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.84)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        truncate(name, BUSINESS_NAME_MAX),
      ),
  );
}

// ---------------------------------------------------------------------------
// Entró, salió, te quedó
// ---------------------------------------------------------------------------

function card(style: Style, ...children: (Element | false | null | undefined)[]): Element {
  return box(
    {
      flexDirection: 'column',
      backgroundColor: COLORS.card,
      borderRadius: 20,
      border: `1px solid ${COLORS.border}`,
      ...style,
    },
    ...children,
  );
}

function amount(
  cents: number,
  options: { size: number; weight: FontWeight; color: string; width: number; zero?: string },
): Element {
  const value = formatSoles(cents);
  return text(
    {
      fontSize: fitFontSize(value, options.width, options.weight, options.size),
      fontWeight: options.weight,
      color: cents === 0 ? (options.zero ?? ZERO) : options.color,
      whiteSpace: 'nowrap',
      lineHeight: 1.15,
    },
    value,
  );
}

function iconChip(icon: Element, background: string): Element {
  return box(
    {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: background,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    icon,
  );
}

interface SplitRow {
  label: string;
  cents: number;
}

function splitRows(rows: SplitRow[]): Element {
  return box(
    {
      flexDirection: 'column',
      marginTop: 8,
      marginLeft: 17,
      paddingLeft: 27,
      borderLeft: `2px solid ${COLORS.border}`,
    },
    ...rows.map((row, i) =>
      box(
        { alignItems: 'center', justifyContent: 'space-between', marginTop: i === 0 ? 0 : 7 },
        text({ fontSize: 14, color: row.cents === 0 ? COLORS.gray : COLORS.muted }, row.label),
        amount(row.cents, { size: 15, weight: 600, color: COLORS.text, width: INNER - 150 }),
      ),
    ),
  );
}

function section(kind: 'in' | 'out', total: number, rows: SplitRow[]): Element {
  const isIn = kind === 'in';
  return box(
    { flexDirection: 'column', padding: `${CARD_PAD}px ${CARD_PAD}px 14px` },
    box(
      { alignItems: 'center' },
      iconChip(
        isIn ? inIcon(20, COLORS.ok) : outIcon(20, COLORS.purple),
        isIn ? COLORS.okSoft : COLORS.lavSoft,
      ),
      text(
        { marginLeft: 10, fontSize: 17, fontWeight: 700, flexGrow: 1 },
        isIn ? 'Entró' : 'Salió',
      ),
      amount(total, {
        size: 22,
        weight: 800,
        color: isIn ? COLORS.ok : COLORS.text,
        width: INNER - 120,
        zero: COLORS.gray,
      }),
    ),
    splitRows(rows),
  );
}

function figuresCard(s: SummaryFigures): Element {
  const inRows: SplitRow[] = [
    { label: 'Yape y Plin', cents: s.digitalSalesCents },
    { label: 'Efectivo', cents: s.cashSalesCents },
  ];
  // 11.6: sales in an unknown method («sin detalle») are part of «entró».
  if ((s.unknownMethodSalesCents ?? 0) > 0) {
    inRows.push({ label: 'Sin detalle', cents: s.unknownMethodSalesCents ?? 0 });
  }
  const outRows: SplitRow[] = [
    { label: 'Mercadería', cents: s.inventoryCents },
    { label: 'Gastos', cents: s.expensesCents },
    { label: 'Casa', cents: s.householdCents },
  ];
  if ((s.unclassifiedCents ?? 0) > 0) {
    outRows.push({ label: 'Por clasificar', cents: s.unclassifiedCents ?? 0 });
  }

  return card(
    { overflow: 'hidden', boxShadow: '0 12px 28px -18px rgba(14,42,139,0.45)' },
    section('in', s.inCents, inRows),
    box({ height: 1, backgroundColor: COLORS.border, margin: `0 ${CARD_PAD}px` }),
    section('out', s.outCents, outRows),
    box(
      {
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `14px ${CARD_PAD}px 15px`,
        backgroundColor: COLORS.lavSoft,
      },
      box(
        { flexDirection: 'column', flexShrink: 0 },
        text({ fontSize: 17, fontWeight: 800, color: COLORS.purple }, 'Te quedó'),
        text({ marginTop: 2, fontSize: 12, color: COLORS.muted }, LEFT_HINT),
      ),
      amount(s.leftCents, {
        size: 32,
        weight: 800,
        color: COLORS.navy,
        width: INNER - 112,
        zero: COLORS.navy,
      }),
    ),
  );
}

function pendingLine(cents: number): Element {
  const label = `${formatSoles(cents)} por confirmar`;
  return box(
    {
      alignItems: 'center',
      marginTop: 10,
      padding: '12px 14px',
      borderRadius: 16,
      backgroundColor: COLORS.warnSoft,
      border: '1px solid #F2D7B5',
    },
    pendingIcon(22, COLORS.warn),
    box(
      { flexDirection: 'column', marginLeft: 11 },
      text(
        { fontSize: fitFontSize(label, INNER - 10, 700, 15), fontWeight: 700, color: WARN_TEXT },
        label,
      ),
      text({ marginTop: 2, fontSize: 12.5, color: COLORS.muted }, PENDING_HINT),
    ),
  );
}

// ---------------------------------------------------------------------------
// Points (13.2): one balance, milestones 50 · 100 · 200 · 400 at even steps
// ---------------------------------------------------------------------------

/** Percent of the bar filled (same rule as the web's `milestoneFill`). */
export function milestoneFill(balance: number, milestones: readonly number[] = MILESTONES): number {
  const stops = [0, ...milestones];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1] as number;
    const to = stops[i] as number;
    if (balance < to) {
      return ((i - 1 + Math.max(0, balance - from) / (to - from)) / milestones.length) * 100;
    }
  }
  return 100;
}

/** «Te faltan 15 para Útiles escolares» (WA-12, 9.2 of the insumos). */
export function nextRewardText(next: SummaryPoints['nextReward']): string | null {
  if (!next || next.missingPoints <= 0) return null;
  const verb = next.missingPoints === 1 ? 'falta' : 'faltan';
  return `Te ${verb} ${formatPoints(next.missingPoints)} para ${next.name}`;
}

const BAR_INSET = 11;
const BAR_HEIGHT = 24;

/** The bar as one SVG: track, fill, and a circle per milestone (a check when reached). */
function milestoneBar(balance: number): Element {
  const track = INNER - 2 * BAR_INSET;
  const fill = (milestoneFill(balance) / 100) * track;
  const at = (i: number) => BAR_INSET + ((i + 1) / MILESTONES.length) * track;
  const cy = BAR_HEIGHT / 2;
  const shapes: Element[] = [
    h('rect', {
      x: BAR_INSET,
      y: cy - 3,
      width: track,
      height: 6,
      rx: 3,
      fill: COLORS.track,
    }),
  ];
  if (fill > 0) {
    shapes.push(
      h('rect', {
        x: BAR_INSET,
        y: cy - 3,
        width: Math.max(6, fill),
        height: 6,
        rx: 3,
        fill: COLORS.navy,
      }),
    );
  }
  MILESTONES.forEach((milestone, i) => {
    const cx = at(i);
    if (balance >= milestone) {
      shapes.push(h('circle', { cx, cy, r: 10, fill: COLORS.navy }));
      shapes.push(
        h('path', {
          d: `M${cx - 4.2} ${cy + 0.2}l2.8 2.8 5.6-5.6`,
          fill: 'none',
          stroke: COLORS.card,
          'stroke-width': 2.2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    } else {
      shapes.push(
        h('circle', {
          cx,
          cy,
          r: 9,
          fill: COLORS.card,
          stroke: MARKER_BORDER,
          'stroke-width': 2,
        }),
      );
    }
  });

  return box(
    { flexDirection: 'column', marginTop: 14 },
    h(
      'svg',
      {
        width: INNER,
        height: BAR_HEIGHT,
        viewBox: `0 0 ${INNER} ${BAR_HEIGHT}`,
        xmlns: 'http://www.w3.org/2000/svg',
      },
      ...shapes,
    ),
    box(
      { position: 'relative', height: 16, width: INNER, marginTop: 4 },
      ...MILESTONES.map((milestone, i) =>
        box(
          {
            position: 'absolute',
            left: at(i) - 22,
            width: 44,
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: balance >= milestone ? 700 : 600,
            color: balance >= milestone ? COLORS.navy : COLORS.gray,
          },
          formatPoints(milestone),
        ),
      ),
    ),
  );
}

function pointsCard(points: SummaryPoints): Element {
  const hint = nextRewardText(points.nextReward);
  return card(
    { marginTop: 10, padding: CARD_PAD },
    box(
      { alignItems: 'center' },
      iconChip(starIcon(20, COLORS.purple), COLORS.lavSoft),
      box(
        { flexDirection: 'column', marginLeft: 10, flexShrink: 1 },
        box(
          { alignItems: 'flex-end' },
          text(
            { fontSize: 22, fontWeight: 800, color: COLORS.navy, lineHeight: 1.1 },
            formatPoints(points.balance),
          ),
          text(
            { marginLeft: 5, marginBottom: 1, fontSize: 15, fontWeight: 600, color: COLORS.muted },
            points.balance === 1 ? 'punto' : 'puntos',
          ),
        ),
        hint &&
          h(
            'div',
            {
              style: {
                display: 'block',
                marginTop: 2,
                fontSize: 13,
                lineHeight: 1.35,
                color: COLORS.muted,
                lineClamp: 2,
              },
            },
            hint,
          ),
      ),
    ),
    milestoneBar(points.balance),
  );
}

// ---------------------------------------------------------------------------
// Sunday: the week (11.11, D38)
// ---------------------------------------------------------------------------

/** PR02 line: the change in «te quedó», or why there is no comparison. */
export function comparisonText(comparison: WeeklyComparison): string {
  if (!comparison.comparable) return NO_COMPARISON_TEXT;
  const delta = comparison.leftDeltaCents;
  if (delta === 0) return 'Te quedó lo mismo que la semana pasada';
  const more = delta > 0 ? 'más' : 'menos';
  return `Te quedó ${formatSoles(Math.abs(delta))} ${more} que la semana pasada`;
}

function weekChart(days: NonNullable<SummaryWeek['days']>, closeDay: string): Element {
  const max = Math.max(...days.map((day) => day.inCents), 1);
  const gap = 8;
  const width = (INNER - gap * 6) / 7;
  const height = 40;
  const byWeekday = new Map(days.map((day) => [isoWeekday(day.businessDay), day]));
  return box(
    { flexDirection: 'column', marginTop: 14 },
    box(
      {
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        height,
        borderBottom: `1px solid ${COLORS.track}`,
      },
      ...WEEKDAY_INITIALS.map((_, i) => {
        const day = byWeekday.get(i + 1);
        const cents = day?.inCents ?? 0;
        const isClose = day?.businessDay === closeDay;
        return box({
          width,
          height: cents > 0 ? Math.max(4, Math.round((cents / max) * (height - 2))) : 3,
          borderRadius: '6px 6px 0 0',
          backgroundColor: cents === 0 ? COLORS.track : isClose ? COLORS.purple : COLORS.lav,
        });
      }),
    ),
    box(
      { justifyContent: 'space-between', marginTop: 5 },
      ...WEEKDAY_INITIALS.map((initial) =>
        box(
          { width, justifyContent: 'center', fontSize: 11, fontWeight: 600, color: COLORS.gray },
          initial,
        ),
      ),
    ),
  );
}

function countChip(label: string, tone: 'ok' | 'warn' | 'gray'): Element {
  const colors = {
    ok: { bg: COLORS.okSoft, fg: COLORS.ok },
    warn: { bg: COLORS.warnSoft, fg: WARN_TEXT },
    gray: { bg: '#EEF2F8', fg: COLORS.muted },
  }[tone];
  return box(
    {
      alignItems: 'center',
      padding: '5px 10px',
      marginRight: 6,
      marginTop: 6,
      borderRadius: 999,
      backgroundColor: colors.bg,
      color: colors.fg,
      fontSize: 12,
      fontWeight: 700,
    },
    label,
  );
}

function weekRow(label: string, cents: number, strong: boolean, color: string): Element {
  return box(
    { alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
    text(
      {
        fontSize: strong ? 15 : 14,
        fontWeight: strong ? 800 : 400,
        color: strong ? COLORS.purple : COLORS.muted,
      },
      label,
    ),
    amount(cents, {
      size: strong ? 18 : 15,
      weight: strong ? 800 : 700,
      color,
      width: INNER - 120,
      zero: strong ? color : ZERO,
    }),
  );
}

/** Lines under the counts: points of the week, streak and freezes used (11.11). */
export function weekMetaLines(week: SummaryWeek): string[] {
  const points = `+${formatPoints(week.pointsEarned)} ${week.pointsEarned === 1 ? 'punto' : 'puntos'} esta semana`;
  const streak = `Racha de ${plural(week.streakDays, 'día', 'días')}`;
  const freezes =
    week.freezesUsed > 0
      ? ` · ${plural(week.freezesUsed, 'comodín usado', 'comodines usados')}`
      : '';
  return [points, `${streak}${freezes}`];
}

function weekCard(week: SummaryWeek, closeDay: string): Element {
  const lines = weekMetaLines(week);
  if (week.comparison) lines.push(comparisonText(week.comparison));
  return card(
    { marginTop: 10, padding: CARD_PAD },
    box(
      { alignItems: 'center' },
      iconChip(calendarIcon(20, COLORS.navy), COLORS.blueSoft),
      box(
        { flexDirection: 'column', marginLeft: 10 },
        text({ fontSize: 17, fontWeight: 700 }, 'Tu semana'),
        text({ fontSize: 12, color: COLORS.muted }, weekLabel(week.weekStart, week.weekEnd)),
      ),
    ),
    week.days && week.days.length > 0 && weekChart(week.days, closeDay),
    box(
      { flexDirection: 'column', marginTop: 6 },
      weekRow('Entró', week.inCents, false, COLORS.ok),
      weekRow('Salió', week.outCents, false, COLORS.text),
      box({ height: 1, backgroundColor: COLORS.border, marginTop: 9 }),
      weekRow('Te quedó', week.leftCents, true, COLORS.navy),
    ),
    box(
      { flexWrap: 'wrap', marginTop: 6 },
      countChip(
        `${formatPoints(week.completeCount)} ${week.completeCount === 1 ? LEVEL_TEXT.complete : 'completos'}`,
        'ok',
      ),
      countChip(`${formatPoints(week.partialCount)} ${LEVEL_TEXT.partial}`, 'warn'),
      countChip(`${formatPoints(week.noCloseCount)} ${LEVEL_TEXT.no_close}`, 'gray'),
    ),
    box(
      { flexDirection: 'column', marginTop: 10 },
      ...lines.map((line, i) =>
        h(
          'div',
          {
            style: {
              display: 'block',
              marginTop: i === 0 ? 0 : 3,
              fontSize: 12.5,
              lineHeight: 1.35,
              color: COLORS.muted,
            },
          },
          line,
        ),
      ),
    ),
  );
}
