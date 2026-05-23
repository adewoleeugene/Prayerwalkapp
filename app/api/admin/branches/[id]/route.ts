import { type NextRequest } from 'next/server';
import { executeRawQuery } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin, isAdminBranchMatch } from '@/policies/adminScope';
import { slugify } from '@/validators/admin';
import { logger } from '@/lib/logger';

function mapBranch(row: any) {
  return { id: row.id, name: row.name, slug: row.slug, lat: Number(row.center_lat), lng: Number(row.center_lng), radiusMeters: Number(row.service_radius_meters), country: row.country, region: row.region, isActive: row.is_active, sortOrder: Number(row.sort_order), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const { id } = await params;
    const payload = await request.json();

    if (!scope.isSuperadmin) {
      const rows = await executeRawQuery<{ id: string; name: string; slug: string }[]>(`SELECT id, name, slug FROM branches WHERE id = $1::uuid`, [id]);
      if (!rows[0]) return Response.json({ error: 'Branch not found' }, { status: 404 });
      if (!isAdminBranchMatch(scope, rows[0])) return Response.json({ error: 'Forbidden: You can only manage your assigned branch' }, { status: 403 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (payload.name !== undefined) {
      const clean = String(payload.name).trim();
      if (!clean) return Response.json({ error: 'name cannot be empty' }, { status: 400 });
      updates.push(`name = $${i++}`); values.push(clean);
    }
    if (payload.slug !== undefined) {
      const clean = slugify(String(payload.slug));
      if (!clean) return Response.json({ error: 'slug cannot be empty' }, { status: 400 });
      updates.push(`slug = $${i++}`); values.push(clean);
    }
    if (payload.lat !== undefined) {
      const clean = Number(payload.lat);
      if (!Number.isFinite(clean)) return Response.json({ error: 'lat must be a valid number' }, { status: 400 });
      updates.push(`center_lat = $${i++}`); values.push(clean);
    }
    if (payload.lng !== undefined) {
      const clean = Number(payload.lng);
      if (!Number.isFinite(clean)) return Response.json({ error: 'lng must be a valid number' }, { status: 400 });
      updates.push(`center_lng = $${i++}`); values.push(clean);
    }
    if (payload.radiusMeters !== undefined) {
      const clean = Number(payload.radiusMeters);
      if (!Number.isFinite(clean) || clean <= 0) return Response.json({ error: 'radiusMeters must be a positive number' }, { status: 400 });
      updates.push(`service_radius_meters = $${i++}`); values.push(Math.round(clean));
    }
    if (payload.country !== undefined) { updates.push(`country = $${i++}`); values.push(String(payload.country || '').trim() || null); }
    if (payload.region !== undefined) { updates.push(`region = $${i++}`); values.push(String(payload.region || '').trim() || null); }
    if (payload.sortOrder !== undefined) {
      const clean = Number(payload.sortOrder);
      if (!Number.isFinite(clean)) return Response.json({ error: 'sortOrder must be a valid number' }, { status: 400 });
      updates.push(`sort_order = $${i++}`); values.push(Math.round(clean));
    }
    if (payload.isActive !== undefined) { updates.push(`is_active = $${i++}`); values.push(Boolean(payload.isActive)); }

    if (updates.length === 0) return Response.json({ error: 'No valid fields provided' }, { status: 400 });

    values.push(id);
    const rows = await executeRawQuery<any[]>(
      `UPDATE branches SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}::uuid
       RETURNING id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at`,
      values
    );
    if (!rows[0]) return Response.json({ error: 'Branch not found' }, { status: 404 });
    return Response.json({ success: true, branch: mapBranch(rows[0]) });
  } catch (e: any) {
    if (String(e?.message || '').includes('branches_slug_key')) return Response.json({ error: 'Branch slug already exists' }, { status: 409 });
    return handleError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const { id } = await params;
    const rows = await executeRawQuery<any[]>(`UPDATE branches SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
    if (!rows[0]) return Response.json({ error: 'Branch not found' }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    logger.error('Admin branch delete error:', error);
    return handleError(error);
  }
}
