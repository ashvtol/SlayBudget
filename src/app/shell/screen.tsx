import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavStore } from '@/lib/stores/nav-store';

interface ScreenState {
  /** This screen is the one shown. */
  active: boolean;
  /** Counts the times the screen was shown again after being hidden; add it to data effects to refresh on return. */
  activation: number;
}

const ScreenContext = createContext<ScreenState>({ active: true, activation: 0 });

/** The keep-alive state of the screen this component is in (always active outside the app shell). */
export function useScreen(): ScreenState {
  return useContext(ScreenContext);
}

/** Keeps a screen mounted once shown; when hidden it keeps its layout (so scroll positions survive)
 *  but is invisible, inert and hidden from assistive tech. */
export function KeptScreen({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  const [activation, setActivation] = useState(0);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setActivation((n) => n + 1);
    wasActive.current = active;
  }, [active]);
  // Cmd+R: the shown screen re-reads its data (the same path as coming back to it).
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(
    () =>
      useNavStore.subscribe((state, previous) => {
        if (state.refreshTick !== previous.refreshTick && activeRef.current) setActivation((n) => n + 1);
      }),
    [],
  );
  return (
    <div
      data-screen={id}
      className="absolute inset-0 flex"
      style={{ visibility: active ? 'visible' : 'hidden', zIndex: active ? 1 : 0 }}
      inert={!active}
      aria-hidden={!active}
    >
      <ScreenContext.Provider value={{ active, activation }}>{children}</ScreenContext.Provider>
    </div>
  );
}
