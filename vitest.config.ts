import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Run each file in its own worker so DB state does not bleed
        pool: 'forks',
        // Serial within a file — each describe block shares DB fixtures
        sequence: { concurrent: false },
        // Longer timeout for real DB ops
        testTimeout: 30_000,
        hookTimeout: 30_000,
        // Load .env before tests
        env: { NODE_ENV: 'test' },
        include: ['tests/**/*.test.ts'],
        reporters: ['verbose'],
    },
});
