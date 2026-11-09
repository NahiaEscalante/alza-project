/** ALZA mark from docs/alza_mvp.html (`I.logo`), with the «ALZA» wordmark (`.brand`). */
const MARK_LIGHT = '#B98CFF';
const MARK_DARK = '#6A00B8';

interface AlzaLogoProps {
  /** Mark size in px (the mockup uses 26). */
  size?: number;
  /** Show the «ALZA» wordmark next to the mark. */
  wordmark?: boolean;
  className?: string;
}

export function AlzaLogo({ size = 26, wordmark = true, className = '' }: AlzaLogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      aria-hidden={wordmark ? true : undefined}
      role={wordmark ? undefined : 'img'}
      aria-label={wordmark ? undefined : 'ALZA'}
    >
      <path d="M2 23L9 16H13L6 23Z" fill={MARK_LIGHT} />
      <path d="M11 23L17 9H23L17 23Z" fill={MARK_DARK} />
    </svg>
  );

  if (!wordmark) return mark;

  return (
    <span
      className={`inline-flex items-center gap-2 text-[22px] font-extrabold text-navy ${className}`}
    >
      {mark}
      ALZA
    </span>
  );
}
