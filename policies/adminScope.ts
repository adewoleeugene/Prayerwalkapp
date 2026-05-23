export type AdminScope = {
  role: string;
  isSuperadmin: boolean;
  branch: string | null;
};

export type AdminUser = {
  role: string;
  branch: string | null;
};

export function getAdminScope(user: AdminUser): AdminScope | null {
  const { role, branch } = user;
  if (role !== 'admin' && role !== 'superadmin') return null;
  if (role === 'superadmin') return { role, isSuperadmin: true, branch: null };
  const trimmedBranch = branch?.trim() || null;
  if (!trimmedBranch) return null;
  return { role, isSuperadmin: false, branch: trimmedBranch };
}

export function requireSuperadmin(scope: AdminScope): boolean {
  return scope.isSuperadmin;
}

export function isAdminBranchMatch(scope: AdminScope, branch: { name: string; slug: string }): boolean {
  if (scope.isSuperadmin) return true;
  const assigned = (scope.branch || '').trim().toLowerCase();
  if (!assigned) return false;
  return assigned === String(branch.slug || '').trim().toLowerCase()
    || assigned === String(branch.name || '').trim().toLowerCase();
}
