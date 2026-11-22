import { describe, expect, it } from 'vitest';
import { errorMessage, normalizedName } from './category-names';

describe('normalizedName', () => {
  it('ignores case, emoji, punctuation and extra spaces', () => {
    expect(normalizedName(' ☕️ Coffee ')).toBe('coffee');
    expect(normalizedName('Food  &  Drink')).toBe('food drink');
  });
});

describe('errorMessage', () => {
  it('reads Error objects, Tauri {code, message} objects and plain strings', () => {
    expect(errorMessage(new Error('a category named Coffee already exists'))).toBe('a category named Coffee already exists');
    expect(errorMessage({ code: 'invalid', message: 'group name is empty' })).toBe('group name is empty');
    expect(errorMessage('boom')).toBe('boom');
  });
});

import { realGroups } from './category-names';

describe('realGroups', () => {
  const g = (id: number, name: string) => ({ id, name, emoji: null, color: '#000', sortOrder: id });
  const c = (id: number, groupId: number, name: string) => ({ id, groupId, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: id, archived: false });
  it('leaves out a group that only holds a category of its own name (a top-level category)', () => {
    const groups = [g(1, 'Food & Drink'), g(2, 'Shopping'), g(3, 'Other')];
    const cats = [c(10, 1, 'Groceries'), c(20, 2, 'Shopping'), c(30, 3, 'Other'), c(31, 3, 'Coffee')];
    expect(realGroups(groups, cats).map((x) => x.name)).toEqual(['Food & Drink', 'Other']);
  });
});
