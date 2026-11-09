/**
 * «Lo que entró cada día» (RF-WP-01, 12.2 ▂▅▃▇▆▄░): one series, Monday to Sunday, plain HTML bars
 * (no chart library). Each day is a button; the chosen one shows its numbers below. Future days are
 * dashed placeholders. Bars keep their height when amounts are hidden; the numbers do not show.
 * Bars are a share of the bar area, which is taller on a computer (D79).
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { capitalize, dayLabel, weekdayInitial } from '../lib/format';
import type { WeekDay } from '../lib/types';
import { ChevronRightIcon } from './icons';
import { Money, useMoneyText } from './money';
import { LevelBadge } from './tags';

export function WeekChart({ days }: { days: WeekDay[] }) {
  const moneyText = useMoneyText();
  const initial =
    days.find((day) => day.isToday) ?? [...days].reverse().find((day) => !day.isFuture) ?? days[0];
  const [selected, setSelected] = useState(initial?.businessDay ?? '');
  const max = Math.max(...days.map((day) => day.inCents), 1);
  const current = days.find((day) => day.businessDay === selected);

  return (
    <div>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form */}
      <div
        role="group"
        aria-label="Lo que entró cada día de esta semana"
        className="grid grid-cols-7 border-b border-[#d9deea]"
      >
        {days.map((day) => {
          const on = day.businessDay === selected;
          const height = day.inCents > 0 ? `max(6px, ${(day.inCents / max) * 100}%)` : 0;
          const name = day.isToday ? 'Hoy' : capitalize(dayLabel(day.businessDay));
          return (
            <button
              key={day.businessDay}
              type="button"
              disabled={day.isFuture}
              aria-pressed={on}
              aria-label={
                day.isFuture
                  ? `${name}: todavía no llega`
                  : `${name}: entró ${moneyText(day.inCents)}`
              }
              onClick={() => setSelected(day.businessDay)}
              className="group flex h-32 flex-col items-center justify-end px-1 pt-2 disabled:cursor-default lg:h-56"
            >
              {day.isFuture ? (
                <span className="block h-5 w-full max-w-6 rounded-t border-2 border-b-0 border-dashed border-[#c5cbe0] lg:max-w-10" />
              ) : (
                <span
                  className={`block w-full max-w-6 rounded-t transition-colors lg:max-w-10 ${
                    on ? 'bg-purple' : 'bg-[#9b6be0] group-hover:bg-[#8653d6]'
                  }`}
                  style={{ height }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-7 pt-1.5" aria-hidden="true">
        {days.map((day) => (
          <span
            key={day.businessDay}
            className={`text-center text-sm leading-5 ${
              day.businessDay === selected ? 'font-bold text-text' : 'text-muted'
            }`}
          >
            {weekdayInitial(day.businessDay)}
          </span>
        ))}
      </div>
      {current && (
        <div className="mt-3 flex items-start justify-between gap-2" aria-live="polite">
          <div className="min-w-0 text-base">
            <p>
              <b className="font-bold">
                {current.isToday ? 'Hoy' : capitalize(dayLabel(current.businessDay))}
              </b>
              {' · Entró '}
              <Money cents={current.inCents} />
            </p>
            <p className="text-[15px] text-muted">
              Salió <Money cents={current.outCents} />
            </p>
            <div className="mt-1">
              <LevelBadge
                level={current.level}
                text={current.levelText}
                isToday={current.isToday}
              />
            </div>
          </div>
          <Link
            href={`/movimientos/${current.businessDay}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-xl px-2 text-[15px] font-semibold text-purple hover:bg-lav-soft"
          >
            Ver el día
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
