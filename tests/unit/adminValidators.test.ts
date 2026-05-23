import { describe, expect, it } from 'vitest';
import { slugify } from '@/validators/admin';

describe('admin validators', () => {
  it('slugifies branch names', () => {
    expect(slugify('Freetown Central')).toBe('freetown-central');
    expect(slugify('  New  Branch  ')).toBe('new-branch');
  });
});
