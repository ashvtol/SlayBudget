import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, NEW_TAG_ORDER, setIpc, TAG_PALETTE } from '@/lib/ipc';
import { useTagsStore } from './tags-store';

describe('tags store', () => {
  beforeEach(() => {
    setIpc(createMemoryIpc({ tags: [{ id: 1, name: 'Work', color: '#4a8ef0' }] }));
    useTagsStore.setState({ tags: [], byId: {} });
  });

  it('loads tags with a lookup by id', async () => {
    await useTagsStore.getState().load();
    expect(useTagsStore.getState().tags.map((t) => t.name)).toEqual(['Work']);
    expect(useTagsStore.getState().byId[1].color).toBe('#4a8ef0');
  });

  it('creates, renames, recolors and deletes, reloading each time', async () => {
    const s = useTagsStore.getState();
    const id = await s.create('Trip');
    expect(useTagsStore.getState().byId[id]).toMatchObject({ name: 'Trip', color: TAG_PALETTE[NEW_TAG_ORDER[1]] });
    await s.update(id, { name: 'Japan trip', color: '#e5484d' });
    expect(useTagsStore.getState().byId[id]).toMatchObject({ name: 'Japan trip', color: '#e5484d' });
    await s.remove(id);
    expect(useTagsStore.getState().byId[id]).toBeUndefined();
  });

  it('passes errors through so the screen can show them', async () => {
    await expect(useTagsStore.getState().create('work')).rejects.toThrow(/already exists/);
  });

  it('names the next new tag "New tag", then "New tag 2"', async () => {
    const s = useTagsStore.getState();
    expect(s.nextNewName()).toBe('New tag');
    await s.create('New tag');
    expect(useTagsStore.getState().nextNewName()).toBe('New tag 2');
  });
});
