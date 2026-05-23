import { executeRawQuery } from '@/lib/db';

export type BranchRow = {
  id: string;
  name: string;
  slug: string;
  center_lat: number;
  center_lng: number;
  service_radius_meters: number;
  country: string | null;
  region: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function listBranchesRaw() {
  return executeRawQuery<BranchRow[]>(
    `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at
     FROM branches
     ORDER BY sort_order ASC, name ASC`
  );
}

export async function findBranchesByAssignedBranch(branch: string) {
  return executeRawQuery<BranchRow[]>(
    `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at
     FROM branches
     WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
     ORDER BY sort_order ASC, name ASC`,
    [branch]
  );
}
