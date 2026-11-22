import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useProfileStore } from './profile-store';

describe('profile store', () => {
  beforeEach(() => {
    setIpc(createMemoryIpc({ profiles: [
      { id: 1, name: 'Alex', color: '#5b8cff', sortOrder: 0 },
      { id: 2, name: 'Jamie', color: '#ff7a6b', sortOrder: 1 },
    ] }));
    useProfileStore.setState({ profiles: [], activeProfileId: null });
  });

  it('loads profiles and defaults to the combined view', async () => {
    await useProfileStore.getState().load();
    expect(useProfileStore.getState().profiles.map((p) => p.name)).toEqual(['Alex', 'Jamie']);
    expect(useProfileStore.getState().activeProfileId).toBeNull();
  });

  it('switches the active profile', () => {
    useProfileStore.getState().setActive(2);
    expect(useProfileStore.getState().activeProfileId).toBe(2);
    useProfileStore.getState().setActive(null);
    expect(useProfileStore.getState().activeProfileId).toBeNull();
  });
});
