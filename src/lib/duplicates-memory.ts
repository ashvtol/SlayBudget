// In-memory mirror of crates/core/src/duplicates.rs (resolving flags; detection only runs in the app).
import type { DuplicateFlag, DuplicateResolution } from './types';

export const DUPLICATE_TAG_NAME = 'Possible duplicate';
export const DUPLICATE_TAG_COLOR = '#ddb24a';

export function openFlagFor(flags: DuplicateFlag[], txId: number): DuplicateFlag | null {
  const open = flags.filter((f) => f.resolution == null && (f.txId === txId || f.otherId === txId));
  return open.length ? { ...open.reduce((a, b) => (b.id > a.id ? b : a)) } : null;
}

export function settle(flag: DuplicateFlag, resolution: DuplicateResolution) {
  if (flag.resolution) return;
  flag.resolution = resolution;
  flag.resolvedAt = new Date().toISOString();
}

/** Does any open flag still need the tag on this row? */
export const stillFlagged = (flags: DuplicateFlag[], txId: number) => flags.some((f) => f.resolution == null && f.txId === txId);

/** Before rows are deleted: resolve their open flags and untag the rows left behind (mirrors `before_delete`). */
export function duplicatesBeforeDelete(flags: DuplicateFlag[], gone: Set<number>, untag: (txId: number) => void) {
  for (const f of flags) {
    if (f.resolution != null) continue;
    if (f.txId != null && gone.has(f.txId)) settle(f, 'deleted');
    else if (f.otherId != null && gone.has(f.otherId)) {
      settle(f, 'other_deleted');
      if (f.txId != null) untag(f.txId);
    }
  }
}
