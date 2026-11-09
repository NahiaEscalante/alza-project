/**
 * Line icons for the user's web (24×24, currentColor), drawn after `docs/alza_mvp.html` (`I`).
 * Decorative: always aria-hidden; the button or text next to them carries the meaning.
 */
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function Icon({ className = 'size-6', children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11l8-6 8 6v9H4z" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3" />
  </Icon>
);

export const GiftIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="9" width="16" height="11" rx="2" />
    <path d="M12 9v11M4 13h16M12 9c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z" />
  </Icon>
);

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.7A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4.4-1" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);

export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 17.5h2" />
  </Icon>
);

export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="9" cy="6" rx="6" ry="2.5" />
    <path d="M3 6v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6" />
    <path d="M3 10v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
    <path d="M19 9.5c1.7.4 2 1.2 2 2.5v4c0 1.4-2.7 2.5-6 2.5" />
  </Icon>
);

export const BankIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

/** Points star (mockup `STAR`), in brand colors. */
export function StarBadge({ className = 'size-9' }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="33" r="22" fill="#E9DDFF" />
      <circle cx="32" cy="32" r="17" fill="#6A00B8" />
      <path
        d="M32 21l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L32 38.4l-6.8 3.7 1.3-7.6-5.5-5.4 7.6-1.1z"
        fill="#FFFFFF"
      />
      <path d="M50 8l1.6 3.4L55 13l-3.4 1.6L50 18l-1.6-3.4L45 13l3.4-1.6z" fill="#4FD1C5" />
    </svg>
  );
}

/** Streak flame (mockup `FLAME`). */
export function FlameBadge({ className = 'size-7' }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M32 6c4 10 16 16 16 30a16 16 0 0 1-32 0c0-7 4-11 6-15 1 5 3 8 6 9-1-9 1-16 4-24z"
        fill="#FFB347"
      />
      <path
        d="M32 30c2 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 6-1-4 0-8 1-13z"
        fill="#FF7A2F"
      />
    </svg>
  );
}

/** Freeze shield (mockup `SHIELD`). */
export function ShieldBadge({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="#0E2A8B" />
    </svg>
  );
}

/** Reward illustrations (mockup `REW_ICO`), picked by milestone. */
export function RewardArt({ kind, className = 'size-14' }: IconProps & { kind: number }) {
  if (kind <= 50) {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
        <path d="M8 32 22 14h32a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H22z" fill="#0E2A8B" />
        <circle cx="21" cy="32" r="3.5" fill="#E9DDFF" />
        <circle cx="34" cy="25" r="3.5" fill="#E9DDFF" />
        <circle cx="47" cy="39" r="3.5" fill="#E9DDFF" />
        <path d="M47 23 34 41" stroke="#4FD1C5" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind <= 100) {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
        <rect x="12" y="12" width="40" height="42" rx="6" fill="#6A00B8" />
        <path
          d="M20 22h24M20 30h24M20 38h16"
          stroke="#E9DDFF"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind <= 400) {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
        <path d="M10 24l22-8 22 8v24l-22 8-22-8z" fill="#6A00B8" />
        <path
          d="M10 24l22 8 22-8M32 32v24"
          fill="none"
          stroke="#0E2A8B"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="10" y="10" width="44" height="46" rx="7" fill="#0E2A8B" />
      <rect x="16" y="16" width="32" height="22" rx="4" fill="#E9DDFF" />
      <circle cx="22" cy="47" r="3" fill="#4FD1C5" />
      <circle cx="32" cy="47" r="3" fill="#4FD1C5" />
      <path d="M40 47h8" stroke="#E9DDFF" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
