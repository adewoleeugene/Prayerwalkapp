export interface BranchSummary {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  country?: string | null;
  region?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface WalkHistoryRoute {
  sessionId: string;
  distanceMeters: number;
  durationSeconds: number;
  points: Array<{ latitude: number; longitude: number }>;
}

export type BranchStats = Record<string, { count: number; distance: number; duration: number }>;
