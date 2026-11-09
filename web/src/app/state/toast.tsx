/** Short confirmations at the bottom of the screen («Listo, lo cambiaste»), read by screen readers. */
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), 3500);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
      >
        {message && (
          <p className="max-w-[408px] rounded-xl bg-text px-4 py-3 text-center text-[15px] font-medium text-white shadow-lg">
            {message}
          </p>
        )}
      </div>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
