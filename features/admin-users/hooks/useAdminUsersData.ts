import { useCallback, useState } from 'react';
import {
  deleteAdmin,
  fetchAdminUsers,
  fetchBranches,
  resetPassword,
  resendInvite,
  toggleAdmin,
} from '../api/adminUsersApi';
import type { AdminUser, Branch } from '../types';

export function useAdminUsersData() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [adminsList, branchesList] = await Promise.all([fetchAdminUsers(), fetchBranches()]);
      setAdmins(adminsList);
      setBranches(branchesList);
    } finally {
      setLoading(false);
    }
  }, []);

  const deactivateOrReactivate = useCallback(async (admin: AdminUser) => {
    await toggleAdmin(admin.id, admin.isActive);
    await load();
  }, [load]);

  const resend = useCallback(async (admin: AdminUser) => {
    await resendInvite(admin.id);
    await load();
  }, [load]);

  const remove = useCallback(async (admin: AdminUser) => {
    await deleteAdmin(admin.id);
    await load();
  }, [load]);

  const sendReset = useCallback(async (admin: AdminUser) => {
    await resetPassword(admin.id);
    await load();
  }, [load]);

  return {
    admins,
    branches,
    loading,
    load,
    deactivateOrReactivate,
    resend,
    remove,
    sendReset,
  };
}
