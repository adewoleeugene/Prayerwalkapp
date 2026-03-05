import type { Request, Response } from 'express';

export type AdminScope = {
  role: string;
  isSuperadmin: boolean;
  branch: string | null;
};

export function getAdminScope(req: Request, res: Response): AdminScope | null {
  const role = req.user?.role || 'user';

  if (role !== 'admin' && role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return null;
  }

  if (role === 'superadmin') {
    return {
      role,
      isSuperadmin: true,
      branch: null,
    };
  }

  const branch = req.user?.branch?.trim() || null;
  if (!branch) {
    res.status(403).json({ error: 'Forbidden: Branch admin requires assigned branch' });
    return null;
  }

  return {
    role,
    isSuperadmin: false,
    branch,
  };
}

export function requireSuperadmin(scope: AdminScope, res: Response): boolean {
  if (!scope.isSuperadmin) {
    res.status(403).json({ error: 'Forbidden: Superadmin access required' });
    return false;
  }
  return true;
}

export function isAdminBranchMatch(scope: AdminScope, branch: { name: string; slug: string }): boolean {
  if (scope.isSuperadmin) {
    return true;
  }
  const assigned = (scope.branch || '').trim().toLowerCase();
  if (!assigned) {
    return false;
  }
  return assigned === String(branch.slug || '').trim().toLowerCase()
    || assigned === String(branch.name || '').trim().toLowerCase();
}
