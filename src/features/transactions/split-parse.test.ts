import { describe, expect, it } from 'vitest';
import { dollarsToCents } from './detail-pane';

describe('dollarsToCents', () => {
  it('parses signed dollar strings to integer cents', () => {
    expect(dollarsToCents('64.18')).toBe(6418);
    expect(dollarsToCents('-54.18')).toBe(-5418);
    expect(dollarsToCents('$1,250.00')).toBe(125000);
    expect(dollarsToCents('0')).toBe(0);
    expect(dollarsToCents('-10')).toBe(-1000);
  });
  it('returns NaN for unparseable input', () => {
    expect(dollarsToCents('')).toBeNaN();
    expect(dollarsToCents('-')).toBeNaN();
    expect(dollarsToCents('abc')).toBeNaN();
    expect(dollarsToCents('1.234')).toBeNaN();
  });
});
