import { THEMES, useThemeStore, type ThemeId } from '@/lib/stores/theme-store';

const PREVIEW: Record<ThemeId, { bg: string; panel: string; accent: string; text: string }> = {
  navy: { bg: '#02080f', panel: '#06101a', accent: '#77a5f2', text: '#e6ebf3' },
  graphite: { bg: '#121212', panel: '#1c1c1c', accent: '#f2f2f2', text: '#f2f2f2' },
  daylight: { bg: '#f4f5f8', panel: '#ffffff', accent: '#2f5bea', text: '#14171f' },
  aurora: { bg: '#0e0b16', panel: '#181327', accent: '#37d6c0', text: '#efeaff' },
  // Half Navy, half Daylight: it follows the Mac.
  system: { bg: 'linear-gradient(135deg, #02080f 50%, #f4f5f8 50%)', panel: '#5d6b80', accent: '#77a5f2', text: '#e6ebf3' },
};

export function AppearancePane() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <section aria-labelledby="theme-heading" className="flex flex-col gap-4 rounded-2xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <div>
        <h2 id="theme-heading" className="m-0 text-base font-semibold">Theme</h2>
        <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>System follows your Mac's light or dark appearance.</p>
      </div>
      <div role="radiogroup" aria-label="Theme" className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {THEMES.map((t) => {
          const p = PREVIEW[t.id];
          const selected = t.id === theme;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void setTheme(t.id)}
              className="flex flex-col gap-2.5 rounded-xl border-2 p-3 text-left"
              style={{ borderColor: selected ? 'var(--accent)' : 'var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
            >
              <span aria-hidden="true" className="flex h-[84px] gap-1.5 rounded-lg p-2" style={{ background: p.bg }}>
                <span className="w-1/4 rounded" style={{ background: p.panel }} />
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="h-2.5 w-7/12 rounded-sm" style={{ background: p.text }} />
                  <span className="flex-1 rounded" style={{ background: p.panel }} />
                  <span className="h-2 w-8/12 rounded" style={{ background: p.accent }} />
                </span>
              </span>
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{t.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
