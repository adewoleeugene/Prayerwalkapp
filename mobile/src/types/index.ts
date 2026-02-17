export interface User {
    id: string;
    email: string;
    name: string;
    stats: {
        totalCompletions: number;
        totalPoints: number;
        totalDistanceMeters: number;
        badgesCount: number;
    };
}

export interface PrayerLocation {
    id: string;
    name: string;
    description: string;
    address: string;
    category: string;
    difficulty: string;
    points: number;
    radiusMeters: number;
    isActive: boolean;
    location: { // GeoJSON Point
        type: 'Point';
        coordinates: [number, number]; // [lng, lat]
    };
    distanceMeters?: number; // Calculated by frontend or backend
}

export interface PrayerSession {
    id: string;
    userId: string;
    locationId?: string;
    startTime: string; // ISO date
    status: 'active' | 'completed' | 'abandoned';
    currentLocation?: {
        type: 'Point';
        coordinates: [number, number];
    };
    distanceTraveled: number;
}

export interface Completion {
    id: string;
    completedAt: string;
    pointsEarned: number;
    locationName: string;
}

export interface Badge {
    id: string;
    name: string;
    icon: string;
    milestone: number;
}
