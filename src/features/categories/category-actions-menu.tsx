import { useCallback, useState } from 'react';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconChevronRight, IconMore } from '@/components/icons';
import { ipc } from '@/lib/ipc';
import { errorMessage } from '@/lib/category-names';
import type { Category, CategoryGroup, GroupTarget } from '@/lib/types';
import { ActionsPopover, MenuItem } from './actions-popover';
import { PALETTE } from './palette';

type Sub = 'group' | 'type' | 'color' | 'newGroup' | null;

/** "⋯" for the selected category: Group ›, Type ›, Color ›, Delete… (not for Other). */
export function CategoryActionsMenu({ category, groups, onChanged, onDelete }: { category: Category; groups: CategoryGroup[]; onChanged: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Sub>(null);
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { setOpen(false); setSub(null); setError(null); }, []);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      close();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const move = (target: GroupTarget) => run(() => ipc().moveCategoryToGroup(category.id, target));

  return (
    <div className="relative">
      <ToolbarButton icon={IconMore} aria-label="Category actions" active={open} onClick={() => (open ? close() : setOpen(true))} />
      {open && (
        <ActionsPopover label="Category actions" onClose={close}>
          {sub === null && (
            <>
              <MenuItem onClick={() => setSub('group')}><span className="flex-1">Group</span><IconChevronRight size={12} /></MenuItem>
              <MenuItem onClick={() => setSub('type')}><span className="flex-1">Type</span><IconChevronRight size={12} /></MenuItem>
              <MenuItem onClick={() => setSub('color')}><span className="flex-1">Color</span><IconChevronRight size={12} /></MenuItem>
              {!category.isOther && <MenuItem danger onClick={() => { close(); onDelete(); }}>Delete…</MenuItem>}
            </>
          )}
          {sub === 'group' && (
            <>
              {groups.filter((g) => g.id !== category.groupId).map((g) => (
                <MenuItem key={g.id} onClick={() => void move({ existing: g.id })}>{g.name}</MenuItem>
              ))}
              <MenuItem onClick={() => setSub('newGroup')}>Start a new group…</MenuItem>
              <MenuItem onClick={() => void move('own')}>Remove from group</MenuItem>
            </>
          )}
          {sub === 'newGroup' && (
            <input
              aria-label="New group name"
              autoFocus
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void move({ new: newGroup })}
              placeholder="Group name"
              className="h-[28px] w-full rounded-md border bg-transparent px-2 text-[13px] outline-none"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          )}
          {sub === 'type' &&
            (['Regular', 'Excluded'] as const).map((t) => (
              <MenuItem key={t} role="menuitemradio" checked={(t === 'Excluded') === category.excluded} onClick={() => void run(() => ipc().updateCategory(category.id, { excluded: t === 'Excluded' }))}>
                {t}
              </MenuItem>
            ))}
          {sub === 'color' && (
            <div className="grid grid-cols-5 gap-1 p-1">
              {PALETTE.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={category.color === c}
                  aria-label={`Color ${i + 1}`}
                  onClick={() => void run(() => ipc().updateCategory(category.id, { color: c }))}
                  className="h-[26px] rounded-md"
                  style={{ background: c, outline: category.color === c ? '2px solid var(--text)' : 'none' }}
                />
              ))}
            </div>
          )}
          {error && <p role="alert" className="m-0 px-2 py-1 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>}
        </ActionsPopover>
      )}
    </div>
  );
}
