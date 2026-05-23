import client from '@/lib/apiClient';
import type { BranchSummary, WalkHistoryRoute } from '../types';

export async function fetchBranches(): Promise<BranchSummary[]> {
  const res = await client.get('/admin/branches');
  return res.data.branches || [];
}

export async function fetchBranchWalks(branchSlug: string, days = 30): Promise<WalkHistoryRoute[]> {
  const params = new URLSearchParams({
    branch: branchSlug,
    allTime: 'true',
    limit: '2000',
    walkType: 'all',
    includeActive: 'true',
    days: String(days),
  });
  const res = await client.get(`/walks/history?${params.toString()}`);
  return res.data.routes || [];
}
