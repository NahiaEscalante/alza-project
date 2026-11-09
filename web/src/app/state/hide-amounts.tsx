/**
 * «Ocultar montos» (RF-WP-11, D51): a view preference remembered only on this phone. Amounts show
 * by default. Not a security control: the data still comes from the server.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'alza.hideAmounts';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function store(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the preference lasts until the page closes.
  }
}

interface HideAmounts {
  hidden: boolean;
  toggle: () => void;
}

const HideAmountsContext = createContext<HideAmounts>({ hidden: false, toggle: () => {} });

export function HideAmountsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readStored);
  const toggle = useCallback(() => {
    setHidden((current) => {
      store(!current);
      return !current;
    });
  }, []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <HideAmountsContext value={value}>{children}</HideAmountsContext>;
}

export const useHideAmounts = () => useContext(HideAmountsContext);
