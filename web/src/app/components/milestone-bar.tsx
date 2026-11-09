/**
 * Points bar with milestones 50 · 100 · 200 · 400 (13.2, D20), Starbucks style: the milestones sit
 * at even steps and the fill moves linearly inside each step. A reached milestone gets a check, so
 * the bar never depends on color alone.
 */
import { formatPoints } from '../lib/format';

export function milestoneFill(balance: number, milestones: readonly number[]): number {
  const stops = [0, ...milestones];
  const steps = milestones.length;
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1] as number;
    const to = stops[i] as number;
    if (balance < to) {
      return ((i - 1 + Math.max(0, balance - from) / (to - from)) / steps) * 100;
    }
  }
  return 100;
}

export function MilestoneBar({
  balance,
  milestones,
  tone = 'navy',
}: {
  balance: number;
  milestones: readonly number[];
  tone?: 'navy' | 'purple';
}) {
  const fill = milestoneFill(balance, milestones);
  const reached = milestones.filter((m) => balance >= m);
  const pending = milestones.filter((m) => balance < m);
  const color = tone === 'navy' ? 'bg-navy' : 'bg-purple';
  const summary =
    reached.length === 0
      ? `Hitos: ${milestones.join(', ')}. Todavía no llegas al primero.`
      : `Hitos alcanzados: ${reached.join(', ')}.${pending.length ? ` Por alcanzar: ${pending.join(', ')}.` : ''}`;

  return (
    <div>
      <p className="sr-only">{summary}</p>
      <div className="relative mx-2.5 h-5.5" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white ring-1 ring-[#d5e9e5]">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${fill}%` }} />
        </div>
        {milestones.map((milestone, i) => {
          const on = balance >= milestone;
          return (
            <span
              key={milestone}
              className={`absolute top-1/2 grid size-5.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 ${
                on ? `border-transparent ${color} text-white` : 'border-[#b8c2d6] bg-white'
              }`}
              style={{ left: `${((i + 1) / milestones.length) * 100}%` }}
            >
              {on && (
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  <path
                    d="M2.5 6.3l2.2 2.2 4.8-4.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          );
        })}
      </div>
      <div className="relative mx-2.5 mt-1.5 h-5" aria-hidden="true">
        {milestones.map((milestone, i) => (
          <span
            key={milestone}
            className={`absolute -translate-x-1/2 text-sm tabular-nums ${
              balance >= milestone ? 'font-bold text-navy' : 'font-semibold text-muted'
            }`}
            style={{ left: `${((i + 1) / milestones.length) * 100}%` }}
          >
            {formatPoints(milestone)}
          </span>
        ))}
      </div>
    </div>
  );
}
