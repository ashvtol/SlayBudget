/** Name used to compare categories and groups: no emoji or punctuation, single spaces, lowercase
 *  (matches the core's `normalized_name`). */
export function normalizedName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** A readable message from a thrown Error, a Tauri `{ code, message }` rejection, or a string. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** True when a group only holds a category of its own name: that is a top-level category. */
export function isTopLevelGroup(group: { id: number; name: string }, categories: { groupId: number; name: string }[]): boolean {
  const members = categories.filter((c) => c.groupId === group.id);
  return members.length === 1 && normalizedName(members[0].name) === normalizedName(group.name);
}

/** Groups a category can be moved into: every group except top-level categories' own groups. */
export function realGroups<G extends { id: number; name: string }>(groups: G[], categories: { groupId: number; name: string }[]): G[] {
  return groups.filter((g) => !isTopLevelGroup(g, categories));
}
