import client from '@/lib/apiClient';
import type { BranchSummary, WalkHistoryRoute } from '../types/index';

/** Bulk-delete prayer sessions by sessionId. Returns the number actually deleted. */
export async function deleteWalks(sessionIds: string[]): Promise<number> {
  // The admin apiClient.delete doesn't support a body, so we use the raw fetch path
  const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;
  const res = await fetch('/api/admin/walks', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.error ?? `Delete failed: ${res.status}`));
  }
  const data = await res.json() as { deleted: number };
  return data.deleted;
}

export async function fetchBranches(): Promise<BranchSummary[]> {
  const res = await client.get<{ branches: BranchSummary[] }>('/admin/branches');
  return res.branches || [];
}

/** Fetch every walk at once — admin only. Used to build branch stats in one round-trip. */
export async function fetchAllWalks(): Promise<WalkHistoryRoute[]> {
  const res = await client.get<{ routes: WalkHistoryRoute[] }>(
    '/walks/history?allTime=true&limit=5000&walkType=all&includeActive=true'
  );
  return res.routes || [];
}

/** Still used for the branch drilldown view (keeps per-branch time-filter support). */
export async function fetchBranchWalks(branchSlug: string, days = 30): Promise<WalkHistoryRoute[]> {
  const params = new URLSearchParams({
    branch: branchSlug,
    allTime: 'true',
    limit: '2000',
    walkType: 'all',
    includeActive: 'true',
    days: String(days),
  });
  const res = await client.get<{ routes: WalkHistoryRoute[] }>(`/walks/history?${params.toString()}`);
  return res.routes || [];
}
