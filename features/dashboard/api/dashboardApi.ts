import client from '@/lib/apiClient';
import type { BranchSummary, WalkHistoryRoute } from '../types/index';

export async function fetchBranches(): Promise<BranchSummary[]> {
  const res = await client.get<{ branches: BranchSummary[] }>('/admin/branches');
  return res.branches || [];
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
  const res = await client.get<{ routes: WalkHistoryRoute[] }>(`/walks/history?${params.toString()}`);
  return res.routes || [];
}
