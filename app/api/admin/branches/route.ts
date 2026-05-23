import { type NextRequest } from 'next/server';
import { executeRawQuery } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { listBranchesRaw, findBranchesByAssignedBranch } from '@/repositories/branchRepository';
import { slugify } from '@/validators/admin';
import { logger } from '@/lib/logger';

function mapBranch(row: any) {
  return { id: row.id, name: row.name, slug: row.slug, lat: Number(row.center_lat), lng: Number(row.center_lng), radiusMeters: Number(row.service_radius_meters), country: row.country, region: row.region, isActive: row.is_active, sortOrder: Number(row.sort_order), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    if (scope.isSuperadmin) {
      const rows = await listBranchesRaw();
      return Response.json({ success: true, count: rows.length, scope: 'global', branches: rows.map(mapBranch) });
    }
    const rows = await findBranchesByAssignedBranch(scope.branch!);
    return Response.json({ success: true, count: rows.length, scope: 'branch', branch: scope.branch, branches: rows.map(mapBranch) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const { name, slug, lat, lng, radiusMeters, country, region, sortOrder, isActive } = await request.json();

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return Response.json({ error: 'name is required' }, { status: 400 });

    const latitude = Number(lat), longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Response.json({ error: 'lat and lng must be valid numbers' }, { status: 400 });

    const cleanSlug = slugify(typeof slug === 'string' && slug.trim() ? slug : cleanName);
    if (!cleanSlug) return Response.json({ error: 'slug could not be generated from input' }, { status: 400 });

    const cleanRadius = radiusMeters == null ? 80000 : Number(radiusMeters);
    if (!Number.isFinite(cleanRadius) || cleanRadius <= 0) return Response.json({ error: 'radiusMeters must be a positive number' }, { status: 400 });

    const cleanSortOrder = sortOrder == null ? 100 : Number(sortOrder);
    if (!Number.isFinite(cleanSortOrder)) return Response.json({ error: 'sortOrder must be a valid number' }, { status: 400 });

    const rows = await executeRawQuery<any[]>(
      `INSERT INTO branches (name, slug, center_lat, center_lng, service_radius_meters, country, region, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at`,
      [cleanName, cleanSlug, latitude, longitude, Math.round(cleanRadius),
       typeof country === 'string' && country.trim() ? country.trim() : null,
       typeof region === 'string' && region.trim() ? region.trim() : null,
       Math.round(cleanSortOrder), isActive === undefined ? true : Boolean(isActive)]
    );
    return Response.json({ success: true, branch: mapBranch(rows[0]) }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message || '').includes('branches_slug_key')) return Response.json({ error: 'Branch slug already exists' }, { status: 409 });
    logger.error('Admin branch create error:', e);
    return handleError(e);
  }
}
