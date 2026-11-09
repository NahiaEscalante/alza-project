/**
 * 6-digit PIN field ([ ● ● ● ● ● ● ] in 12.2): one real numeric input over six boxes, so the phone
 * shows the number pad, paste works and screen readers hear a single «PIN» field.
 */
import { useEffect, useRef } from 'react';

export const PIN_LENGTH = 6;

export function PinField({
  id,
  label,
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when the 6th digit is typed (e.g. to verify right away). */
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-semibold text-text">
        {label}
      </label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
            onChange(digits);
            if (digits.length === PIN_LENGTH && digits !== value) onComplete?.(digits);
          }}
          className="peer absolute inset-0 z-10 h-full w-full cursor-text text-base opacity-0 disabled:cursor-not-allowed"
        />
        <div
          aria-hidden="true"
          className="grid grid-cols-6 gap-2 rounded-2xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-navy"
        >
          {Array.from({ length: PIN_LENGTH }, (_, i) => {
            const filled = i < value.length;
            const current = i === value.length && !disabled;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed six boxes
                key={i}
                className={`grid h-14 place-items-center rounded-xl border-2 bg-white transition-colors ${
                  invalid
                    ? 'border-danger'
                    : current
                      ? 'border-navy'
                      : filled
                        ? 'border-[#b9a3e8]'
                        : 'border-border'
                } ${disabled ? 'opacity-60' : ''}`}
              >
                {filled && <span className="size-3.5 rounded-full bg-navy" />}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
