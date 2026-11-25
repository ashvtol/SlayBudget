import { describe, expect, it } from 'vitest';
import { groupLookAlikes } from './recurring-page';

describe('groupLookAlikes', () => {
  it('joins pairs that share a bill into one group, oldest first', () => {
    expect(groupLookAlikes([[25, 26], [25, 27], [26, 27]])).toEqual([{ ids: [25, 26, 27], pairs: [[25, 26], [25, 27], [26, 27]] }]);
  });
  it('keeps unrelated pairs apart and joins two groups a later pair bridges', () => {
    expect(groupLookAlikes([[1, 2], [5, 6]]).map((g) => g.ids)).toEqual([[1, 2], [5, 6]]);
    expect(groupLookAlikes([[1, 2], [3, 4], [2, 3]]).map((g) => g.ids)).toEqual([[1, 2, 3, 4]]);
  });
});
