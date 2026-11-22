// Chart colors pulled from the active theme's CSS variables, so charts restyle
// with the app theme. In jsdom (tests) getComputedStyle returns empty, so every
// token has a fallback (the Navy values).

export interface ChartTokens {
  text: string;
  muted: string;
  subtle: string;
  line: string;
  grid: string;
  pos: string;
  neg: string;
  warn: string;
  current: string;
  income: string;
  spend: string;
  accent: string;
  track: string;
  panel: string;
}

const FALLBACK: ChartTokens = {
  text: '#e6ebf3', muted: '#7e8a9c', subtle: '#56677b', line: '#111c2d', grid: '#0e1828',
  pos: '#57bd57', neg: '#e34e3a', warn: '#eaa64a', current: '#ebc769',
  income: '#81aef2', spend: '#4c85ee', accent: '#77a5f2', track: '#0f1f36', panel: '#06101a',
};

export function readChartTokens(el: Element | null = typeof document !== 'undefined' ? document.documentElement : null): ChartTokens {
  if (!el || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(el);
  const out = { ...FALLBACK };
  for (const name of Object.keys(FALLBACK) as (keyof ChartTokens)[]) {
    out[name] = style.getPropertyValue(`--${name}`).trim() || FALLBACK[name];
  }
  return out;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
