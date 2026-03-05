import { describe, expect, it } from 'vitest';
import {
  calculateDistanceMeters,
  cleanRoutePoints,
  parseCoordinateSearchTerm,
  parseParticipants,
} from '../../src/services/walks/routeUtils';

describe('walk route utils', () => {
  it('parses participants from json and csv', () => {
    expect(parseParticipants('["A"," B "]')).toEqual(['A', 'B']);
    expect(parseParticipants('A, B')).toEqual(['A, B']);
  });

  it('parses coordinate terms', () => {
    expect(parseCoordinateSearchTerm('8.48,-13.23')).toEqual({ latitude: 8.48, longitude: -13.23 });
    expect(parseCoordinateSearchTerm('invalid')).toBeNull();
  });

  it('cleans unrealistic point jumps', () => {
    const points = [
      { latitude: 8.484, longitude: -13.23 },
      { latitude: 8.4841, longitude: -13.2301 },
      { latitude: 9.0, longitude: -14.0 },
    ];
    const cleaned = cleanRoutePoints(points);
    expect(cleaned.length).toBe(2);
  });

  it('computes positive distance', () => {
    const meters = calculateDistanceMeters(
      { latitude: 8.484, longitude: -13.23 },
      { latitude: 8.485, longitude: -13.231 }
    );
    expect(meters).toBeGreaterThan(0);
  });
});
