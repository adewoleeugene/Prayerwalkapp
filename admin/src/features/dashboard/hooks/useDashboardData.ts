import { useCallback, useEffect, useState } from 'react';
import { fetchBranches, fetchBranchWalks } from '../api/dashboardApi';
import type { BranchStats, BranchSummary, WalkHistoryRoute } from '../types';

export function useDashboardData() {
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchStats, setBranchStats] = useState<BranchStats>({});
  const [branchesLoading, setBranchesLoading] = useState(true);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      const list = await fetchBranches();
      setBranches(list);

      const results = await Promise.allSettled(
        list.map(async (branch) => {
          const rows = await fetchBranchWalks(branch.slug);
          return {
            slug: branch.slug,
            count: rows.length,
            distance: rows.reduce((sum, row) => sum + Number(row.distanceMeters || 0), 0),
            duration: rows.reduce((sum, row) => sum + Number(row.durationSeconds || 0), 0),
          };
        })
      );

      const stats: BranchStats = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          stats[result.value.slug] = result.value;
        }
      });
      setBranchStats(stats);
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  const loadWalksForBranch = useCallback(async (branch: BranchSummary, days = 30): Promise<WalkHistoryRoute[]> => {
    return fetchBranchWalks(branch.slug, days);
  }, []);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  return {
    branches,
    branchStats,
    branchesLoading,
    loadBranches,
    loadWalksForBranch,
  };
}
