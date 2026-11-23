import { describe, expect, it } from 'vitest';
import { monthInitial } from './budget-history';

describe('monthInitial', () => {
  it('maps YYYY-MM to the month initial', () => {
    expect(['2026-01', '2026-05', '2026-09', '2026-12'].map(monthInitial)).toEqual(['J', 'M', 'S', 'D']);
  });
});
