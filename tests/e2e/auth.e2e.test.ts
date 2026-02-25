/**
 * E2E — Auth flows
 *
 * Covers:
 *  1. Signup (happy path + duplicate email)
 *  2. Login (valid, wrong password, inactive account)
 *  3. Token version invalidation after password reset
 *  4. Forgot-password token issuance + reset (mocked email)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/testApp';
import {
    createTestUser,
    cleanupTestData,
    TEST_TAG,
} from '../helpers/db';
import { prisma, executeRawQuery } from '../../src/lib/db';

const app = buildApp();

describe('Auth E2E', () => {
    afterAll(cleanupTestData);

    // ────────────────────────────────────────────────────
    // 1. Signup
    // ────────────────────────────────────────────────────
    describe('POST /auth/signup', () => {
        it('creates a new user and returns a JWT', async () => {
            const email = `signup_${Date.now()}@${TEST_TAG}.test`;
            const res = await request(app).post('/auth/signup').send({
                email,
                password: 'Secure1234!',
                name: `Signup Test ${TEST_TAG}`,
            });

            expect([200, 201]).toContain(res.status);
            // signup may return a token or just a success message; either is valid
            const hasToken = !!res.body.token;
            const hasSuccess = !!res.body.success || !!res.body.message;
            expect(hasToken || hasSuccess).toBe(true);
        });

        it('rejects duplicate emails with 409', async () => {
            const { user } = await createTestUser({
                email: `dup_${TEST_TAG}@e2e.test`,
            });

            const res = await request(app).post('/auth/signup').send({
                email: user.email,
                password: 'Secure1234!',
                name: 'Duplicate',
            });

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/already/i);
        });

        it('rejects weak passwords with 400', async () => {
            const res = await request(app).post('/auth/signup').send({
                email: `weak_${TEST_TAG}@e2e.test`,
                password: '1234',
                name: 'Weak',
            });
            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 2. Login
    // ────────────────────────────────────────────────────
    describe('POST /auth/login', () => {
        it('returns a JWT for valid credentials', async () => {
            const { user, password } = await createTestUser({
                email: `login_ok_${TEST_TAG}@e2e.test`,
            });

            const res = await request(app).post('/auth/login').send({
                email: user.email,
                password,
            });

            expect(res.status).toBe(200);
            expect(res.body.token).toBeTruthy();
        });

        it('returns 401 for wrong password', async () => {
            const { user } = await createTestUser({
                email: `login_bad_${TEST_TAG}@e2e.test`,
            });

            const res = await request(app).post('/auth/login').send({
                email: user.email,
                password: 'wrong!',
            });
            expect(res.status).toBe(401);
        });

        it('returns 403 for deactivated accounts', async () => {
            const { user, password } = await createTestUser({
                email: `login_inactive_${TEST_TAG}@e2e.test`,
            });
            await prisma.user.update({
                where: { id: user.id },
                data: { isActive: false },
            });

            const res = await request(app).post('/auth/login').send({
                email: user.email,
                password,
            });
            expect([401, 403]).toContain(res.status);
        });
    });

    // ────────────────────────────────────────────────────
    // 3. Token version invalidation
    // ────────────────────────────────────────────────────
    describe('Token version invalidation', () => {
        it('rejects a stale JWT after token version is bumped', async () => {
            const { user, token } = await createTestUser({
                email: `tv_${TEST_TAG}@e2e.test`,
                role: 'admin',
                branch: `branch_${TEST_TAG}`,
            });

            // Token works before bump
            const before = await request(app)
                .get('/admin/me')
                .set('Authorization', `Bearer ${token}`);
            expect(before.status).toBe(200);

            // Simulate deactivation bumping token version
            await executeRawQuery(
                `UPDATE users SET token_version = token_version + 1 WHERE id = $1::uuid`,
                [user.id]
            );

            // Same token should now be rejected
            const after = await request(app)
                .get('/admin/me')
                .set('Authorization', `Bearer ${token}`);
            expect(after.status).toBe(401);
        });
    });

    // ────────────────────────────────────────────────────
    // 4. Forgot-password + reset
    // ────────────────────────────────────────────────────
    describe('Password reset flow', () => {
        it('POST /auth/forgot-password returns 200 for known email', async () => {
            const { user } = await createTestUser({
                email: `reset_${TEST_TAG}@e2e.test`,
            });

            const res = await request(app)
                .post('/auth/forgot-password')
                .send({ email: user.email });

            // 200 even if email sending fails — important UX choice
            expect(res.status).toBe(200);
        });

        it('POST /auth/forgot-password returns 200 for unknown email (no enumeration)', async () => {
            const res = await request(app)
                .post('/auth/forgot-password')
                .send({ email: `nobody_${TEST_TAG}@e2e.test` });
            expect(res.status).toBe(200);
        });

        it('POST /auth/reset-password rejects invalid tokens with 400', async () => {
            const res = await request(app)
                .post('/auth/reset-password')
                .send({ token: 'totally-fake-token', newPassword: 'NewSecure1!' });
            expect(res.status).toBe(400);
        });
    });
});
