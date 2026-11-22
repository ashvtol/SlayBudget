import type { Source } from './types';

/** Stable dot colors for sources, assigned in sidebar order. */
export const SOURCE_DOTS = ['#4c85ee', '#e34e3a', '#57bd57', '#bb45f3', '#e8c34f', '#81aef2', '#e8743b'];

/** Dot color per source id, in sidebar order: grouped by institution, first seen first. */
export function sourceDotColors(sources: Source[]): Record<number, string> {
  const order: string[] = [];
  for (const s of sources) {
    const inst = s.institution ?? 'Other';
    if (!order.includes(inst)) order.push(inst);
  }
  const out: Record<number, string> = {};
  let i = 0;
  for (const inst of order) {
    for (const s of sources) if ((s.institution ?? 'Other') === inst) out[s.id] = SOURCE_DOTS[i++ % SOURCE_DOTS.length];
  }
  return out;
}
