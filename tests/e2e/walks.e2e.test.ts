/**
 * E2E — Walk session lifecycle
 *
 * Covers:
 *  1. POST /walks/start  → 201, returns session.id
 *  2. POST /walks/arrive → updates currentLocation (GPS events go via WebSocket — not tested here)
 *  3. POST /walks/complete → marks session completed
 *  4. GET  /walks/history → completed walk appears, branch-scoped
 *  5. Branch isolation   → other branch admin cannot see this branch's walks
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/testApp';
import {
    createTestUser,
    createTestAdmin,
    cleanupTestData,
    TEST_TAG,
} from '../helpers/db';
import { prisma } from '../../src/lib/db';

const app = buildApp();

const BRANCH = `wbranch_${TEST_TAG}`;

let walkerToken: string;
let adminToken: string;
let otherAdminToken: string;
let sessionId: string;

beforeAll(async () => {
    const walker = await createTestUser({
        email: `walker_${Date.now()}@${TEST_TAG}.test`,
        branch: BRANCH,
    });
    walkerToken = walker.token;

    const admin = await createTestAdmin(BRANCH);
    adminToken = admin.token;

    const other = await createTestAdmin(`other_${TEST_TAG}`);
    otherAdminToken = other.token;
});

afterAll(cleanupTestData);

describe('Walk lifecycle E2E', () => {

    // ────────────────────────────────────────────────────
    // 1. Start — returns { session: { id } }
    // ────────────────────────────────────────────────────
    describe('POST /walks/start', () => {
        it('creates an active session (201) and returns session.id', async () => {
            const res = await request(app)
                .post('/walks/start')
                .set('Authorization', `Bearer ${walkerToken}`)
                .send({
                    latitude: 51.5074,
                    longitude: -0.1278,
                    branch: BRANCH,    // stored on the session row
                });

            expect([200, 201]).toContain(res.status);
            // Route returns { session: { id, ... } } on 201
            // or { session: existingSession } on 200 (resume)
            const id = res.body.session?.id ?? res.body.sessionId;
            expect(id).toBeTruthy();
            sessionId = id;

            const row = await prisma.prayerSession.findUnique({ where: { id: sessionId } });
            expect(row).not.toBeNull();
            expect(row!.status).toBe('active');
            expect(row!.branch).toBe(BRANCH);
        });

        it('returns 401 without token', async () => {
            const res = await request(app).post('/walks/start')
                .send({ latitude: 51.5, longitude: -0.1 });
            expect(res.status).toBe(401);
        });
    });

    // ────────────────────────────────────────────────────
    // 2. Arrive — updates currentLocation, integrity score
    // ────────────────────────────────────────────────────
    describe('POST /walks/arrive', () => {
        it('succeeds for an active session', async () => {
            expect(sessionId).toBeTruthy();

            const res = await request(app)
                .post('/walks/arrive')
                .set('Authorization', `Bearer ${walkerToken}`)
                .send({
                    sessionId,
                    latitude: 51.5080,
                    longitude: -0.1280,
                });

            expect([200, 201]).toContain(res.status);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 for a non-existent session', async () => {
            const res = await request(app)
                .post('/walks/arrive')
                .set('Authorization', `Bearer ${walkerToken}`)
                .send({
                    sessionId: '00000000-0000-0000-0000-000000000000',
                    latitude: 51.5,
                    longitude: -0.1,
                });
            expect(res.status).toBe(400);
        });

        it('returns 401 without token', async () => {
            const res = await request(app).post('/walks/arrive')
                .send({ sessionId, latitude: 51.5, longitude: -0.1 });
            expect(res.status).toBe(401);
        });
    });

    // ────────────────────────────────────────────────────
    // 3. Complete — marks session completed
    // ────────────────────────────────────────────────────
    describe('POST /walks/complete', () => {
        it('marks the session as completed', async () => {
            expect(sessionId).toBeTruthy();

            const res = await request(app)
                .post('/walks/complete')
                .set('Authorization', `Bearer ${walkerToken}`)
                .send({
                    sessionId,
                    latitude: 51.5080,
                    longitude: -0.1280,
                    prayerSummary: 'E2E test prayer summary',
                });

            expect([200, 201]).toContain(res.status);
            expect(res.body.success).toBe(true);

            const row = await prisma.prayerSession.findUnique({ where: { id: sessionId } });
            expect(row!.status).toBe('completed');
        });

        it('returns 400 if session already completed', async () => {
            const res = await request(app)
                .post('/walks/complete')
                .set('Authorization', `Bearer ${walkerToken}`)
                .send({ sessionId, latitude: 51.5, longitude: -0.1 });
            expect(res.status).toBe(400);
        });
    });

    // ────────────────────────────────────────────────────
    // 4. History — completed walk visible to correct admin
    // ────────────────────────────────────────────────────
    describe('GET /walks/history', () => {
        it('returns 401 without a token', async () => {
            const res = await request(app).get('/walks/history');
            expect(res.status).toBe(401);
        });

        it('returns 200 with routes array for authenticated admin', async () => {
            const res = await request(app)
                .get('/walks/history')
                .set('Authorization', `Bearer ${adminToken}`)
                .query({ days: 1 });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.routes)).toBe(true);
        });

        it('completed walk appears in admin history with sessionId field', async () => {
            const res = await request(app)
                .get('/walks/history')
                .set('Authorization', `Bearer ${adminToken}`)
                .query({ days: 1 });

            const ids: string[] = (res.body.routes ?? []).map((r: any) => r.sessionId);
            expect(ids).toContain(sessionId);
        });

        it('completed walk has at least a startLocation point', async () => {
            const res = await request(app)
                .get('/walks/history')
                .set('Authorization', `Bearer ${adminToken}`)
                .query({ days: 1 });

            const walk = (res.body.routes ?? []).find((r: any) => r.sessionId === sessionId);
            expect(walk).toBeDefined();
            // Route has at least startLocation (GPS events come via WS, so points may be 1 spot)
            const points: any[] = walk.points ?? [];
            expect(points.length).toBeGreaterThan(0);
        });
    });

    // ────────────────────────────────────────────────────
    // 5. Branch isolation — other admin cannot see this walk
    // ────────────────────────────────────────────────────
    describe('Branch isolation', () => {
        it('admin on a different branch does NOT see this walk', async () => {
            const res = await request(app)
                .get('/walks/history')
                .set('Authorization', `Bearer ${otherAdminToken}`)
                .query({ days: 1 });

            expect(res.status).toBe(200);
            const ids: string[] = (res.body.routes ?? []).map((r: any) => r.sessionId);
            expect(ids).not.toContain(sessionId);
        });
    });
});
