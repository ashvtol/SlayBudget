import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import type { Tag, TagPatch } from '@/lib/types';

interface TagsState {
  /** Creation order, as Copilot lists them. */
  tags: Tag[];
  byId: Record<number, Tag>;
  load(): Promise<void>;
  /** Errors (empty, too long, duplicate name) are passed through for the screen to show. */
  create(name: string, color?: string): Promise<number>;
  update(id: number, patch: TagPatch): Promise<void>;
  remove(id: number): Promise<void>;
  /** "New tag", or "New tag 2", 3... when taken. */
  nextNewName(): string;
}

/** Tags shared by the Transactions screen and Settings, so a change in one shows in the other. */
export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],
  byId: {},

  async load() {
    const tags = await ipc().listTags();
    set({ tags, byId: Object.fromEntries(tags.map((t) => [t.id, t])) });
  },

  async create(name, color) {
    const id = await ipc().createTag(name, color ?? null);
    await get().load();
    return id;
  },

  async update(id, patch) {
    try {
      await ipc().updateTag(id, patch);
    } finally {
      await get().load();
    }
  },

  async remove(id) {
    await ipc().deleteTag(id);
    await get().load();
  },

  nextNewName() {
    const taken = new Set(get().tags.map((t) => t.name.toLowerCase()));
    if (!taken.has('new tag')) return 'New tag';
    let n = 2;
    while (taken.has(`new tag ${n}`)) n++;
    return `New tag ${n}`;
  },
}));
