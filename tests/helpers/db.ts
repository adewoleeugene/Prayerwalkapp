/**
 * Test database helpers.
 * All helpers prefix data with a unique test-run ID so we can
 * wipe only our own rows without touching real data.
 */
import { prisma, executeRawQuery } from '../../src/lib/db';
import { hashPassword } from '../../src/lib/auth';
import { generateToken } from '../../src/lib/auth';

// Each test file runs in its own fork; add Math.random() to prevent timestamp collision
export const TEST_TAG = `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/** Create a plain user (role = 'user') and return their signed JWT. */
export async function createTestUser(overrides: {
    email?: string;
    password?: string;
    name?: string;
    branch?: string | null;
    role?: string;
} = {}) {
    // Each caller must pass a unique email or we generate one with extra entropy
    const email = overrides.email ?? `u_${Date.now()}_${Math.random().toString(36).slice(2)}@${TEST_TAG}.test`;
    const password = overrides.password ?? 'Test1234!';
    const name = overrides.name ?? `E2E User ${TEST_TAG}`;
    const role = overrides.role ?? 'user';
    const branch = overrides.branch ?? null;

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
        data: { email, passwordHash, name, role, branch, isActive: true }
    });

    const tokenVersion = 0;
    const token = generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        branch: user.branch,
        tokenVersion,
    });

    return { user, token, password };
}

/** Create a branch admin and return their JWT. */
export async function createTestAdmin(branch = `b_${TEST_TAG}`) {
    return createTestUser({
        role: 'admin',
        branch,
        email: `a_${Date.now()}_${Math.random().toString(36).slice(2)}@${TEST_TAG}.test`,
        name: `E2E Admin ${TEST_TAG}`,
    });
}

/** Create a superadmin and return their JWT. */
export async function createTestSuperadmin() {
    return createTestUser({
        role: 'superadmin',
        email: `sa_${Date.now()}_${Math.random().toString(36).slice(2)}@${TEST_TAG}.test`,
        name: `E2E Superadmin ${TEST_TAG}`,
    });
}

/**
 * Ensure a branch row exists in the branches table.
 * Supplies all NOT NULL columns (center_lat, center_lng, service_radius_meters).
 * Returns the slug.
 */
export async function ensureTestBranch(name: string, slug: string) {
    await executeRawQuery(
        `INSERT INTO branches (name, slug, center_lat, center_lng, service_radius_meters, is_active)
         VALUES ($1, $2, 51.5074, -0.1278, 80000, true)
         ON CONFLICT (slug) DO NOTHING`,
        [name, slug]
    );
    return slug;
}

/** Create a walk session for a user and return the session. */
export async function createTestWalkSession(userId: string, branch: string | null = null, status = 'active') {
    return prisma.prayerSession.create({
        data: {
            userId,
            status,
            branch,
            startLocation: JSON.stringify({ type: 'Point', coordinates: [-0.1, 51.5] }),
            currentLocation: JSON.stringify({ type: 'Point', coordinates: [-0.1, 51.5] }),
        }
    });
}

/** Wipe all rows created during this test run. */
export async function cleanupTestData() {
    // Cascade deletes GPS events, flags, checkpoints, completions
    await prisma.prayerSession.deleteMany({
        where: { user: { email: { contains: TEST_TAG } } }
    });
    await prisma.user.deleteMany({
        where: { email: { contains: TEST_TAG } }
    });
    // Clean orphaned admin_invites from this test run
    await executeRawQuery(
        `DELETE FROM admin_invites WHERE email LIKE $1`,
        [`%${TEST_TAG}%`]
    );
    // Clean test branches
    await executeRawQuery(
        `DELETE FROM branches WHERE slug LIKE $1`,
        [`%${TEST_TAG}%`]
    );
}
