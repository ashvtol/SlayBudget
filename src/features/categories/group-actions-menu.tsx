import { useCallback, useState } from 'react';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconMore } from '@/components/icons';
import { ipc } from '@/lib/ipc';
import { errorMessage } from '@/lib/category-names';
import type { CategoryGroup } from '@/lib/types';
import { ActionsPopover, MenuItem } from './actions-popover';

/** "⋯" for the selected group: Rename group, Ungroup these categories. */
export function GroupActionsMenu({ group, onChanged }: { group: CategoryGroup; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { setOpen(false); setRenaming(false); setError(null); }, []);
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      close();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="relative">
      <ToolbarButton icon={IconMore} aria-label="Group actions" active={open} onClick={() => (open ? close() : (setName(group.name), setOpen(true)))} />
      {open && (
        <ActionsPopover label="Group actions" onClose={close}>
          {renaming ? (
            <input
              aria-label="Group name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void run(() => ipc().renameGroup(group.id, name))}
              className="h-[28px] w-full rounded-md border bg-transparent px-2 text-[13px] outline-none"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          ) : (
            <>
              <MenuItem onClick={() => setRenaming(true)}>Rename group</MenuItem>
              <MenuItem onClick={() => void run(() => ipc().ungroup(group.id))}>Ungroup these categories</MenuItem>
            </>
          )}
          {error && <p role="alert" className="m-0 px-2 py-1 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>}
        </ActionsPopover>
      )}
    </div>
  );
}
