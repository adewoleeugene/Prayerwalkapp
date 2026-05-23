import { useCallback, useEffect, useState } from 'react';
import { fetchProfile, updateName } from '../api/settingsApi';
import type { AdminProfile } from '../types';

export function useAdminProfile() {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const next = await fetchProfile();
      setProfile(next);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const saveName = useCallback(async (name: string) => {
    await updateName(name);
    setProfile((prev) => (prev ? { ...prev, name } : prev));
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  return {
    profile,
    profileLoading,
    loadProfile,
    saveName,
  };
}
