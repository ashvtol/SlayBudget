import type { Category, CategoryGroup } from './types';

/** Categories without their own color take their group's color (pills, charts). */
export function withGroupColors(categories: Category[], groups: CategoryGroup[]): Category[] {
  const groupColor = new Map(groups.map((g) => [g.id, g.color]));
  return categories.map((c) => (c.color ? c : { ...c, color: groupColor.get(c.groupId) ?? null }));
}
