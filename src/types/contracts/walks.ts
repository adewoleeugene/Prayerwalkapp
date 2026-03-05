export type LatLng = {
  latitude: number;
  longitude: number;
};

export type WalkTypeFilter = 'all' | 'path' | 'area';

export interface WalkHistoryRoute {
  sessionId: string;
  userId: string;
  walkType: WalkTypeFilter;
  geometryType: 'path' | 'spot';
  routeQuality: 'high' | 'medium' | 'low';
  branch: string;
  status: 'active' | 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string | null;
  durationSeconds: number;
  distanceMeters: number;
  opacity: number;
  points: LatLng[];
}
