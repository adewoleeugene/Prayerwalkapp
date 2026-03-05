import client from '@/api/client';
import type { AdminProfile } from '../types';

export async function fetchProfile(): Promise<AdminProfile> {
  const res = await client.get('/admin/me');
  return res.data.profile;
}

export async function updateName(name: string) {
  return client.patch('/admin/me', { name });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return client.post('/admin/change-password', { currentPassword, newPassword });
}
