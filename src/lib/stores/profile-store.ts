import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import type { Profile } from '@/lib/types';

interface ProfileState {
  profiles: Profile[];
  /** null = the combined view across all profiles. */
  activeProfileId: number | null;
  load(): Promise<void>;
  setActive(id: number | null): void;
  create(name: string, color?: string): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  async load() {
    const profiles = await ipc().listProfiles();
    set({ profiles });
  },
  setActive(id) {
    set({ activeProfileId: id });
  },
  async create(name, color) {
    await ipc().createProfile(name, color ?? null);
    await get().load();
  },
  async rename(id, name) {
    await ipc().renameProfile(id, name);
    await get().load();
  },
  async remove(id) {
    await ipc().deleteProfile(id);
    if (get().activeProfileId === id) set({ activeProfileId: null });
    await get().load();
  },
}));
