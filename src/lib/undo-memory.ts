// Undo and redo for the in-memory IPC (tests and the browser preview): a mirror of crates/core/src/undo.rs, with a
// snapshot of the data per action instead of a SQLite changeset. Labels mirror src-tauri/src/commands.rs.
import type { TransactionPatch, UndoState } from './types';

export const UNDO_DEPTH = 15;

/** "Change Category" for one row, "Change Category of 3 Transactions" for several (mirrors `count_label`). */
export function countLabel(what: string, n: number): string {
  if (n === 1) return what.replace(/ (to|from)$/, '');
  const rows = `${n} Transactions`;
  if (what === 'Mark Reviewed') return `Mark ${rows} Reviewed`;
  if (what === 'Mark Unreviewed') return `Mark ${rows} Unreviewed`;
  if (/ (to|from)$/.test(what)) return `${what} ${rows}`;
  return `${what} of ${rows}`;
}

/** The Edit menu's name for a transaction edit (mirrors `patch_label`). */
export function patchLabel(patch: TransactionPatch, n: number): string {
  const what =
    patch.notes !== undefined ? 'Edit Notes'
    : patch.categoryId !== undefined ? 'Change Category'
    : patch.reviewed === true ? 'Mark Reviewed'
    : patch.reviewed === false ? 'Mark Unreviewed'
    : 'Edit';
  return countLabel(what, n);
}

export const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

type Args = unknown[];
/** The label for each recorded method, from its arguments. */
export const UNDO_LABELS: Record<string, (args: Args) => string> = {
  updateTransaction: (a) => patchLabel(a[1] as TransactionPatch, 1),
  bulkUpdateTransactions: (a) => patchLabel(a[1] as TransactionPatch, (a[0] as number[]).length),
  splitTransaction: () => 'Split Transaction',
  unsplitTransaction: () => 'Unsplit Transaction',
  createCategory: () => 'New Category',
  deleteCategory: () => 'Delete Category',
  moveCategoryToGroup: () => 'Move Category',
  renameGroup: () => 'Rename Group',
  ungroup: () => 'Ungroup',
  updateCategory: () => 'Edit Category',
  importCsvText: (a) => `Import ${fileName(a[1] as string)}`,
  importOfxText: (a) => `Import ${fileName(a[1] as string)}`,
  importPdfDoc: (a) => `Import ${fileName(a[1] as string)}`,
  setTransactionCategory: () => 'Change Category',
  applyRecategorize: (a) => countLabel('Change Category', (a[0] as number[]).length),
  saveRule: () => 'Save Rule',
  setTransactionType: (a) => countLabel('Change Type', (a[0] as number[]).length),
  createRecurring: () => 'New Recurring',
  updateRecurring: () => 'Edit Recurring',
  setRecurringStatus: () => 'Change Recurring Status',
  deleteRecurring: () => 'Delete Recurring',
  unlinkRecurring: () => 'Not Recurring',
  dismissSuggestion: () => 'Dismiss Suggestion',
  createTag: () => 'New Tag',
  updateTag: () => 'Edit Tag',
  deleteTag: () => 'Delete Tag',
  addTags: (a) => countLabel('Add Tag to', (a[0] as number[]).length),
  removeTags: (a) => countLabel('Remove Tag from', (a[0] as number[]).length),
  setBudget: () => 'Change Budget',
  setGroupBudget: () => 'Change Budget',
  setRollover: () => 'Change Rollover',
  applyRebalance: () => 'Rebalance Budgets',
  deleteTransactions: (a) => ((a[0] as number[]).length === 1 ? 'Delete Transaction' : `Delete ${(a[0] as number[]).length} Transactions`),
  resolveDuplicate: (a) => (a[1] === 'kept' ? 'Not a Duplicate' : 'Delete Transaction'),
};

/** Steps hold the data as it was before (undo) or after (redo) the action. */
export function createUndoStack<S>(capture: () => S, restore: (s: S) => void, same: (a: S, b: S) => boolean) {
  const undo: { label: string; before: S; after: S }[] = [];
  let redo: { label: string; before: S; after: S }[] = [];
  let depth = 0;
  return {
    /** Run one action as one step; nested recorded calls belong to the outer one. */
    async record<T>(label: string, run: () => Promise<T>): Promise<T> {
      if (depth > 0) return run();
      const before = capture();
      depth++;
      try {
        const value = await run();
        const after = capture();
        if (!same(before, after)) {
          undo.push({ label, before, after });
          if (undo.length > UNDO_DEPTH) undo.shift();
          redo = [];
        }
        return value;
      } finally {
        depth--;
      }
    },
    undo(): string | null {
      const step = undo.pop();
      if (!step) return null;
      restore(step.before);
      redo.push(step);
      return step.label;
    },
    redo(): string | null {
      const step = redo.pop();
      if (!step) return null;
      restore(step.after);
      undo.push(step);
      return step.label;
    },
    state(): UndoState {
      return { undo: undo.at(-1)?.label ?? null, redo: redo.at(-1)?.label ?? null };
    },
  };
}
