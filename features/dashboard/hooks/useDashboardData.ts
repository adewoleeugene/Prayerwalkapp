import { useCallback, useEffect, useState } from 'react';
import { fetchBranches, fetchAllWalks, fetchBranchWalks } from '../api/dashboardApi';
import type { BranchStats, BranchSummary, WalkHistoryRoute } from '../types';

/**
 * Match a walk to a branch by comparing the walk's `branch` string against
 * the branch slug and name (case-insensitive, substring both ways).
 */
function matchesBranch(walk: WalkHistoryRoute, branch: BranchSummary): boolean {
  const walkBranch = ((walk as any).branch || '').toLowerCase().trim();
  if (!walkBranch) return false;
  const slug = branch.slug.toLowerCase();
  const name = branch.name.toLowerCase();
  return (
    walkBranch.includes(slug) ||
    walkBranch.includes(name) ||
    slug.includes(walkBranch) ||
    name.includes(walkBranch)
  );
}

export function useDashboardData() {
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchStats, setBranchStats] = useState<BranchStats>({});
  const [branchesLoading, setBranchesLoading] = useState(true);
  // Cache of all walks — reused for drilldown so we don't re-fetch
  const [allWalksCache, setAllWalksCache] = useState<WalkHistoryRoute[]>([]);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      // Two parallel requests instead of 15+1 sequential ones
      const [list, allWalks] = await Promise.all([
        fetchBranches(),
        fetchAllWalks(),
      ]);

      setBranches(list);
      setAllWalksCache(allWalks);

      // Aggregate walk stats per branch on the client — no extra DB round-trips
      const stats: BranchStats = {};
      for (const branch of list) {
        const branchWalks = allWalks.filter(w => matchesBranch(w, branch));
        stats[branch.slug] = {
          count: branchWalks.length,
          distance: branchWalks.reduce((s, w) => s + Number(w.distanceMeters || 0), 0),
          duration: branchWalks.reduce((s, w) => s + Number(w.durationSeconds || 0), 0),
        };
      }
      setBranchStats(stats);
    } catch (err) {
      console.error('Failed to load branches', err);
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  /**
   * Returns cached walks filtered to a branch.
   * Falls back to a fresh API call if cache is empty (e.g. after a refresh).
   */
  const loadWalksForBranch = useCallback(
    async (branch: BranchSummary, _days = 30): Promise<WalkHistoryRoute[]> => {
      if (allWalksCache.length > 0) {
        return allWalksCache.filter(w => matchesBranch(w, branch));
      }
      // Cache miss — fetch directly
      return fetchBranchWalks(branch.slug, _days);
    },
    [allWalksCache]
  );

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
