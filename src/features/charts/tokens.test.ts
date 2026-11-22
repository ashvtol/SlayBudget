import { describe, expect, it } from 'vitest';
import { readChartTokens } from './tokens';

describe('readChartTokens', () => {
  it('reads the Copilot chart colors from the theme variables', () => {
    const el = document.createElement('div');
    el.style.setProperty('--current', '#ebc769');
    el.style.setProperty('--warn', '#eaa64a');
    el.style.setProperty('--income', '#81aef2');
    el.style.setProperty('--spend', '#4c85ee');
    el.style.setProperty('--grid', '#0e1828');
    el.style.setProperty('--subtle', '#56677b');
    document.body.appendChild(el);
    const t = readChartTokens(el);
    expect([t.current, t.warn, t.income, t.spend, t.grid, t.subtle]).toEqual(['#ebc769', '#eaa64a', '#81aef2', '#4c85ee', '#0e1828', '#56677b']);
    el.remove();
  });

  it('falls back to Navy values when variables are missing', () => {
    const t = readChartTokens(null);
    expect(t.current).toBe('#ebc769');
    expect(t.warn).toBe('#eaa64a');
  });
});
