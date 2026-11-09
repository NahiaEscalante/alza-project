/**
 * Icons drawn by the template (8.6: no emojis inside the image). 20×20 grid, 2 px strokes, the
 * same family as the web icons.
 */
import { COLORS, LOGO } from './brand.js';
import { type Element, h } from './element.js';

function svg(size: number, viewBox: string, ...children: Element[]): Element {
  return h(
    'svg',
    { width: size, height: size, viewBox, xmlns: 'http://www.w3.org/2000/svg' },
    ...children,
  );
}

function stroke(d: string, color: string, width = 2): Element {
  return h('path', {
    d,
    fill: 'none',
    stroke: color,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

function fill(d: string, color: string): Element {
  return h('path', { d, fill: color });
}

export function logoMark(size: number): Element {
  return svg(size, LOGO.viewBox, ...LOGO.bars.map((bar) => fill(bar.d, bar.fill)));
}

/** Entró: an arrow coming down into the tray. */
export function inIcon(size: number, color: string): Element {
  return svg(size, '0 0 20 20', stroke('M10 3v9.5M5.8 8.3 10 12.5l4.2-4.2M4 16.5h12', color));
}

/** Salió: an arrow leaving the tray. */
export function outIcon(size: number, color: string): Element {
  return svg(size, '0 0 20 20', stroke('M10 12.5V3M5.8 7.2 10 3l4.2 4.2M4 16.5h12', color));
}

/** «Por confirmar»: the web's pending triangle, with a mark. */
export function pendingIcon(size: number, color: string): Element {
  return svg(
    size,
    '0 0 20 20',
    h('path', {
      d: 'M10 2.6 18.6 17.4H1.4Z',
      fill: color,
      stroke: color,
      'stroke-width': 1.6,
      'stroke-linejoin': 'round',
    }),
    stroke('M10 8v4.2', COLORS.card, 2),
    h('circle', { cx: 10, cy: 14.9, r: 1.1, fill: COLORS.card }),
  );
}

export function starIcon(size: number, color: string): Element {
  return svg(
    size,
    '0 0 20 20',
    h('path', {
      d: 'M10 2.2l2.36 4.78 5.28.77-3.82 3.72.9 5.25L10 14.24 5.28 16.72l.9-5.25L2.36 7.75l5.28-.77z',
      fill: color,
      stroke: color,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
}

export function calendarIcon(size: number, color: string): Element {
  return svg(
    size,
    '0 0 20 20',
    h('rect', {
      x: 3,
      y: 4.5,
      width: 14,
      height: 12.5,
      rx: 2.6,
      fill: 'none',
      stroke: color,
      'stroke-width': 2,
    }),
    stroke('M3.5 8.8h13M7 2.6v3.6M13 2.6v3.6', color),
  );
}

export function checkIcon(size: number, color: string): Element {
  return svg(size, '0 0 12 12', stroke('M2.5 6.3l2.2 2.2 4.8-4.8', color, 2));
}
