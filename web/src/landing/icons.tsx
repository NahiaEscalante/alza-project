/** Small line icons for the landing (24×24, currentColor). Decorative: always aria-hidden. */
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

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Icon>
);

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const HandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L4 15.3a1.6 1.6 0 0 1 2.4-2L8 15V11" />
  </Icon>
);

export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const SearchCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M8 11l2 2 4-4" />
  </Icon>
);

export const BanknoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </Icon>
);

export const MessageIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5z" />
  </Icon>
);

export const CheckCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.7 2.7L16 9.8" />
  </Icon>
);

export const CalculatorIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5V18M8.5 18h.01M12 18h.01" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3.5 10h17" />
  </Icon>
);

export const StarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />
  </Icon>
);

export const BellOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.9 3.7A6 6 0 0 1 18 8.5c0 2.8.6 4.8 1.4 6.2M17 18H4s2-1.8 2-7.5c0-.8.1-1.5.4-2.2" />
    <path d="M10.3 21a2 2 0 0 0 3.4 0M3 3l18 18" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const QrIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M21 14v.01M14 21h7v-4M17.5 17.5v.01" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Icon>
);

/** WhatsApp-style double check, drawn small (used inside the phone mock). */
export function DoubleCheck({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 16 11" aria-hidden="true" className={className} fill="currentColor">
      <path d="M11.07.65l-6.4 7.9-2.3-2.3-.95.95 3.35 3.3 7.35-9.05z" />
      <path d="M14.6.65l-6.4 7.9-.75-.75-.95.95 1.8 1.75 7.35-9.05z" />
    </svg>
  );
}

/** Points star used in rewards and the points card (from docs/alza_mvp.html `STAR`). */
export function PointsStar({ className = 'size-10' }: IconProps) {
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

/** Reward illustrations from docs/alza_mvp.html (`REW_ICO`). */
export function RewardArt({ kind, className = 'size-14' }: IconProps & { kind: RewardKind }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      {REWARD_ART[kind]}
    </svg>
  );
}

export type RewardKind = 'discount' | 'school' | 'supplier' | 'appliance' | 'kit';

const REWARD_ART: Record<RewardKind, ReactNode> = {
  discount: (
    <>
      <path d="M8 32 22 14h32a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H22z" fill="#0E2A8B" />
      <circle cx="21" cy="32" r="3.5" fill="#E9DDFF" />
      <circle cx="34" cy="25" r="3.5" fill="#E9DDFF" />
      <circle cx="47" cy="39" r="3.5" fill="#E9DDFF" />
      <path d="M47 23 34 41" stroke="#4FD1C5" strokeWidth="3.5" strokeLinecap="round" />
    </>
  ),
  school: (
    <>
      <rect x="12" y="12" width="40" height="42" rx="6" fill="#6A00B8" />
      <path
        d="M20 22h24M20 30h24M20 38h16"
        stroke="#E9DDFF"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </>
  ),
  supplier: (
    <>
      <path d="M10 24l22-8 22 8v24l-22 8-22-8z" fill="#6A00B8" />
      <path
        d="M10 24l22 8 22-8M32 32v24"
        fill="none"
        stroke="#0E2A8B"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </>
  ),
  kit: (
    <>
      <rect x="10" y="20" width="44" height="32" rx="6" fill="#0E2A8B" />
      <path d="M24 20v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5" stroke="#0E2A8B" strokeWidth="3" />
      <rect x="28" y="30" width="8" height="12" rx="2" fill="#4FD1C5" />
      <path d="M10 34h44" stroke="#E9DDFF" strokeWidth="2.5" />
    </>
  ),
  appliance: (
    <>
      <rect x="14" y="6" width="36" height="52" rx="6" fill="#6A00B8" />
      <path d="M14 24h36" stroke="#E9DDFF" strokeWidth="2.5" />
      <path d="M20 14v4M20 30v8" stroke="#E9DDFF" strokeWidth="3" strokeLinecap="round" />
      <circle cx="42" cy="15" r="3" fill="#4FD1C5" />
    </>
  ),
};
