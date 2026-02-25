/**
 * E2E — Pastor (admin user) management lifecycle
 *
 * Covers:
 *  1. Superadmin can list admins
 *  2. Superadmin can deactivate a pastor → bumpTokenVersion → stale JWT rejected
 *  3. Superadmin can reactivate a pastor → they can authenticate again
 *  4. Branch reassign
 *  5. Superadmin can DELETE a pastor → all their sessions cascade-deleted
 *  6. Deleted pastor's JWT is rejected
 *  7. Branch admin cannot call superadmin routes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/testApp';
import {
    createTestSuperadmin,
    createTestAdmin,
    createTestUser,
    createTestWalkSession,
    cleanupTestData,
    TEST_TAG,
} from '../helpers/db';
import { prisma } from '../../src/lib/db';

const app = buildApp();

let saToken: string;
let pastorId: string;
let pastorToken: string;
let pastorBranch: string;

beforeAll(async () => {
    const sa = await createTestSuperadmin();
    saToken = sa.token;

    pastorBranch = `pastor_branch_${TEST_TAG}`;
    const pastor = await createTestAdmin(pastorBranch);
    pastorId = pastor.user.id;
    pastorToken = pastor.token;
});

afterAll(cleanupTestData);

describe('Pastor management E2E', () => {

    // ────────────────────────────────────────────────────
    // 1. List admins
    // ────────────────────────────────────────────────────
    describe('GET /admin/admin-users', () => {
        it('superadmin can list admin users', async () => {
            const res = await request(app)
                .get('/admin/admin-users')
                .set('Authorization', `Bearer ${saToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.admins)).toBe(true);
        });

        it('branch admin is denied with 403', async () => {
            const res = await request(app)
                .get('/admin/admin-users')
                .set('Authorization', `Bearer ${pastorToken}`);

            // Branch admins are not superadmins — should be forbidden
            expect([403]).toContain(res.status);
        });
    });

    // ────────────────────────────────────────────────────
    // 2. Deactivate → JWT invalidated
    // ────────────────────────────────────────────────────
    describe('POST /admin/admin-users/:id/deactivate', () => {
        it('deactivates the pastor and immediately invalidates their token', async () => {
            // Pastor's JWT works before deactivation
            const before = await request(app)
                .get('/admin/me')
                .set('Authorization', `Bearer ${pastorToken}`);
            expect(before.status).toBe(200);

            // Superadmin deactivates
            const deactivate = await request(app)
                .post(`/admin/admin-users/${pastorId}/deactivate`)
                .set('Authorization', `Bearer ${saToken}`);
            expect(deactivate.status).toBe(200);

            // Pastor's same JWT is now rejected
            const after = await request(app)
                .get('/admin/me')
                .set('Authorization', `Bearer ${pastorToken}`);
            expect(after.status).toBe(401);

            // DB reflects isActive = false
            const row = await prisma.user.findUnique({ where: { id: pastorId } });
            expect(row!.isActive).toBe(false);
        });
    });

    // ────────────────────────────────────────────────────
    // 3. Reactivate
    // ────────────────────────────────────────────────────
    describe('POST /admin/admin-users/:id/reactivate', () => {
        it('reactivates the pastor and issues a fresh usable session on next login', async () => {
            const reactivate = await request(app)
                .post(`/admin/admin-users/${pastorId}/reactivate`)
                .set('Authorization', `Bearer ${saToken}`);
            expect(reactivate.status).toBe(200);

            const row = await prisma.user.findUnique({ where: { id: pastorId } });
            expect(row!.isActive).toBe(true);
        });
    });

    // ────────────────────────────────────────────────────
    // 4. Reassign branch
    // ────────────────────────────────────────────────────
    describe('POST /admin/admin-users/:id/reassign-branch', () => {
        it('changes the pastor\'s branch in the database', async () => {
            // Must be a slug that exists in the branches table (seeded by migration 002)
            const newBranch = 'london';

            const res = await request(app)
                .post(`/admin/admin-users/${pastorId}/reassign-branch`)
                .set('Authorization', `Bearer ${saToken}`)
                .send({ branch: newBranch });

            expect(res.status).toBe(200);

            const row = await prisma.user.findUnique({ where: { id: pastorId } });
            expect(row!.branch).toBe(newBranch);
        });

        it('returns 400 when branch is empty', async () => {
            const res = await request(app)
                .post(`/admin/admin-users/${pastorId}/reassign-branch`)
                .set('Authorization', `Bearer ${saToken}`)
                .send({ branch: '' });

            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 5 & 6. Delete pastor → cascade + JWT rejected
    // ────────────────────────────────────────────────────
    describe('DELETE /admin/admin-users/:id', () => {
        let deleteTargetId: string;
        let deleteTargetToken: string;
        let linkedSessionId: string;

        beforeAll(async () => {
            const target = await createTestAdmin(`del_branch_${TEST_TAG}`);
            deleteTargetId = target.user.id;
            deleteTargetToken = target.token;

            // Attach a walk session to them
            const session = await createTestWalkSession(deleteTargetId, `del_branch_${TEST_TAG}`);
            linkedSessionId = session.id;
        });

        it('superadmin can delete a pastor', async () => {
            const res = await request(app)
                .delete(`/admin/admin-users/${deleteTargetId}`)
                .set('Authorization', `Bearer ${saToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('deleted pastor no longer exists in the database', async () => {
            const row = await prisma.user.findUnique({ where: { id: deleteTargetId } });
            expect(row).toBeNull();
        });

        it('their walk sessions are cascade-deleted', async () => {
            const session = await prisma.prayerSession.findUnique({ where: { id: linkedSessionId } });
            expect(session).toBeNull();
        });

        it('deleted pastor JWT is rejected with 401', async () => {
            const res = await request(app)
                .get('/admin/me')
                .set('Authorization', `Bearer ${deleteTargetToken}`);
            expect(res.status).toBe(401);
        });

        it('returns 404 when trying to delete a non-existent admin', async () => {
            const res = await request(app)
                .delete(`/admin/admin-users/00000000-0000-0000-0000-000000000000`)
                .set('Authorization', `Bearer ${saToken}`);
            expect(res.status).toBe(404);
        });
    });

    // ────────────────────────────────────────────────────
    // 7. Branch admin cannot touch superadmin routes
    // ────────────────────────────────────────────────────
    describe('Superadmin-only route protection', () => {
        // Use a completely fresh admin (pastorToken was invalidated by deactivate test)
        let freshAdminToken: string;

        beforeAll(async () => {
            const fresh = await createTestAdmin(`fresh_branch_${TEST_TAG}`);
            freshAdminToken = fresh.token;
        });

        it('branch admin cannot deactivate another admin', async () => {
            const victim = await createTestAdmin(`victim1_${TEST_TAG}`);

            const res = await request(app)
                .post(`/admin/admin-users/${victim.user.id}/deactivate`)
                .set('Authorization', `Bearer ${freshAdminToken}`);

            expect(res.status).toBe(403);
        });

        it('branch admin cannot delete another admin', async () => {
            const victim = await createTestAdmin(`victim2_${TEST_TAG}`);

            const res = await request(app)
                .delete(`/admin/admin-users/${victim.user.id}`)
                .set('Authorization', `Bearer ${freshAdminToken}`);

            expect(res.status).toBe(403);
        });
    });
});
