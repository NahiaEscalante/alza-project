/**
 * ALZA visual language for generated files (summary image, PDF, Excel): the `:root` tokens of
 * `docs/alza_mvp.html` and the logo mark. One color scheme only (an image does not follow dark
 * mode, 8.6).
 */

export const COLORS = {
  navy: '#0E2A8B',
  purple: '#6A00B8',
  purpleDeep: '#4E0090',
  lav: '#E9DDFF',
  lavSoft: '#EFE7FF',
  blueSoft: '#EAF0FF',
  bg: '#F7F8FC',
  card: '#FFFFFF',
  text: '#10172F',
  muted: '#475569',
  gray: '#64748B',
  border: '#E4E8F1',
  track: '#D9DEEA',
  ok: '#0B6B4B',
  okSoft: '#E3F3EC',
  warn: '#B45309',
  warnSoft: '#FDF1E3',
  mint: '#4FD1C5',
  logoLight: '#B98CFF',
} as const;

/** The landing's closing card and the web's balance card (`.vcard`). */
export const HEADER_GRADIENT = 'linear-gradient(135deg, #7B3FF2 0%, #4B1BB8 60%, #3A1296 100%)';

/** Logo mark: two slanted bars, viewBox 0 0 26 26. */
export const LOGO = {
  viewBox: '0 0 26 26',
  bars: [
    { d: 'M2 23L9 16H13L6 23Z', fill: COLORS.logoLight },
    { d: 'M11 23L17 9H23L17 23Z', fill: COLORS.purple },
  ],
} as const;
