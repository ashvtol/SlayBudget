import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup } from './types';
import { withGroupColors } from './category-colors';

const groups: CategoryGroup[] = [{ id: 1, name: 'Food', emoji: null, color: '#e8743b', sortOrder: 0 }];
const cat = (id: number, color: string | null, groupId = 1): Category => ({
  id, groupId, name: `C${id}`, emoji: null, color, budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false,
});

describe('withGroupColors', () => {
  it("gives a category without a color its group's color", () => {
    expect(withGroupColors([cat(10, null)], groups)[0].color).toBe('#e8743b');
  });
  it('keeps a color the category already has', () => {
    expect(withGroupColors([cat(11, '#00ff00')], groups)[0].color).toBe('#00ff00');
  });
  it('leaves it empty when the group is unknown', () => {
    expect(withGroupColors([cat(12, null, 99)], groups)[0].color).toBeNull();
  });
});
