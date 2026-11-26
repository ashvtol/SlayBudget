import { useEffect } from 'react';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';

/** Load analytics for the active profile whenever the profile, the range or the day changes. */
export function useAnalyticsData() {
  const activeProfile = useProfileStore((s) => s.activeProfileId);
  const range = useAnalyticsStore((s) => s.range);
  const today = useAnalyticsStore((s) => s.today);
  const load = useAnalyticsStore((s) => s.load);
  useEffect(() => {
    void load(activeProfile);
  }, [load, activeProfile, range, today]);
}
