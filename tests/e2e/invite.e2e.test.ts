/**
 * E2E — Invite accept flow
 *
 * Covers:
 *  1. Superadmin creates an invite (requires branch to exist)
 *  2. Accepting with a valid token activates account + returns JWT
 *  3. Re-accepting same token fails (used)
 *  4. Expired token is rejected
 *  5. Invalid token is rejected
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/testApp';
import {
    createTestSuperadmin,
    ensureTestBranch,
    cleanupTestData,
    TEST_TAG,
} from '../helpers/db';
import { executeRawQuery } from '../../src/lib/db';
import { createOpaqueToken, hashToken } from '../../src/lib/security';

const app = buildApp();

let saToken: string;

beforeAll(async () => {
    const sa = await createTestSuperadmin();
    saToken = sa.token;
});

afterAll(cleanupTestData);

describe('Invite accept E2E', () => {

    // ────────────────────────────────────────────────────
    // 1. Superadmin fires an invite
    // ────────────────────────────────────────────────────
    describe('POST /admin/admin-invites', () => {
        it('creates an invite and returns 201 when branch exists', async () => {
            const slug = await ensureTestBranch(`Inv Branch ${TEST_TAG}`, `inv_${TEST_TAG}`);

            const res = await request(app)
                .post('/admin/admin-invites')
                .set('Authorization', `Bearer ${saToken}`)
                .send({
                    email: `invite_${Date.now()}@${TEST_TAG}.test`,
                    branch: slug,
                    pastorName: `Invited Pastor ${TEST_TAG}`,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.inviteId).toBeTruthy();
        });

        it('returns 400 when branch does not exist', async () => {
            const res = await request(app)
                .post('/admin/admin-invites')
                .set('Authorization', `Bearer ${saToken}`)
                .send({
                    email: `nobody_${Date.now()}@${TEST_TAG}.test`,
                    branch: 'totally-nonexistent-branch',
                });

            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 2–3. Accept flow (direct DB token injection for determinism)
    // ────────────────────────────────────────────────────
    describe('POST /auth/invite/accept', () => {
        let rawToken: string;
        const inviteEmail = `accept_${Date.now()}@${TEST_TAG}.test`;
        const inviteBranch = `acc_${TEST_TAG}`;

        beforeAll(async () => {
            // Ensure the branch exists (route validates it)
            await ensureTestBranch(`Accept Branch ${TEST_TAG}`, inviteBranch);

            // Write a valid pending invite directly to the DB
            rawToken = createOpaqueToken();
            const tokenHash = hashToken(rawToken);
            const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

            await executeRawQuery(
                `INSERT INTO admin_invites
                   (email, branch, role, token_hash, expires_at, status)
                 VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending')`,
                [inviteEmail, inviteBranch, tokenHash, expiresAt.toISOString()]
            );
        });

        it('accepting a valid invite activates the account and returns a JWT', async () => {
            const res = await request(app)
                .post('/auth/invite/accept')
                .send({
                    token: rawToken,
                    name: `Accepted Pastor ${TEST_TAG}`,
                    password: 'NewPass1234!',
                });

            expect(res.status).toBe(200);
            expect(res.body.token).toBeTruthy();
            expect(res.body.user.email).toBe(inviteEmail);
            expect(res.body.user.role).toBe('admin');
        });

        it('re-accepting the same token returns 400 (already used)', async () => {
            const res = await request(app)
                .post('/auth/invite/accept')
                .send({
                    token: rawToken,
                    name: 'Duplicate',
                    password: 'NewPass1234!',
                });

            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 4. Expired token
    // ────────────────────────────────────────────────────
    describe('POST /auth/invite/accept (expired)', () => {
        it('rejects an expired invite token with 400', async () => {
            const expiredBranch = `exp_${TEST_TAG}`;
            await ensureTestBranch(`Expired Branch ${TEST_TAG}`, expiredBranch);

            const rawToken = createOpaqueToken();
            const tokenHash = hashToken(rawToken);
            // Already expired 1 second ago
            const expiredAt = new Date(Date.now() - 1000);

            await executeRawQuery(
                `INSERT INTO admin_invites
                   (email, branch, role, token_hash, expires_at, status)
                 VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending')`,
                [`expired_${Date.now()}@${TEST_TAG}.test`, expiredBranch, tokenHash, expiredAt.toISOString()]
            );

            const res = await request(app)
                .post('/auth/invite/accept')
                .send({
                    token: rawToken,
                    name: 'Expired',
                    password: 'NewPass1234!',
                });

            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 5. Invalid token
    // ────────────────────────────────────────────────────
    describe('POST /auth/invite/accept (invalid token)', () => {
        it('rejects a made-up token with 400', async () => {
            const res = await request(app)
                .post('/auth/invite/accept')
                .send({
                    token: 'totally-made-up-token',
                    name: 'Invalid',
                    password: 'NewPass1234!',
                });

            expect(res.status).toBe(400);
        });
    });
});
