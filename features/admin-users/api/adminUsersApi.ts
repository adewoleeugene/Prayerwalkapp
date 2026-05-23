import client from '@/lib/apiClient';
import type { AdminUser, Branch } from '../types/index';

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await client.get<{ admins: AdminUser[] }>('/admin/admin-users');
  return res.admins || [];
}

export async function fetchBranches(): Promise<Branch[]> {
  const res = await client.get<{ branches: Branch[] }>('/admin/branches');
  return res.branches || [];
}

export async function inviteAdmin(payload: { email: string; pastorName: string; branch: string }): Promise<{ inviteLink?: string; warning?: string }> {
  return client.post('/admin/admin-invites', payload);
}

export async function reassignBranch(adminId: string, branch: string) {
  return client.post(`/admin/admin-users/${adminId}/reassign-branch`, { branch });
}

export async function toggleAdmin(adminId: string, isActive: boolean) {
  const path = isActive ? 'deactivate' : 'reactivate';
  return client.post(`/admin/admin-users/${adminId}/${path}`);
}

export async function resendInvite(adminId: string) {
  return client.post(`/admin/admin-users/${adminId}/resend-invite`);
}

export async function resetPassword(adminId: string) {
  return client.post(`/admin/admin-users/${adminId}/reset-password`);
}

export async function deleteAdmin(adminId: string) {
  return client.delete(`/admin/admin-users/${adminId}`);
}
