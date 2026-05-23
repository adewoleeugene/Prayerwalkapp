import client from '@/lib/apiClient';
import type { AdminProfile } from '../types/index';

export async function fetchProfile(): Promise<AdminProfile> {
  const res = await client.get<{ profile: AdminProfile }>('/admin');
  return res.profile;
}

export async function updateName(name: string) {
  return client.patch('/admin', { name });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return client.post('/admin', { currentPassword, newPassword });
}
