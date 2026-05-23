export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  branch: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  inviteStatus: string | null;
  inviteExpiresAt: string | null;
}

export interface Branch {
  id: string;
  name: string;
  slug: string;
}
