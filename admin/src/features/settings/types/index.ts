export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  branch?: string | null;
  lastLoginAt?: string | null;
}
