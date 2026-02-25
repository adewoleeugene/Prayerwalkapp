#!/usr/bin/env tsx
/**
 * scripts/db-reset.ts
 *
 * Wipes the database and rebuilds it from scratch:
 *   1. Drop all known tables/views/functions
 *   2. Re-run all SQL migrations (001 → 006)
 *   3. Seed: guest user + superadmin + prayer locations
 *
 * Usage:
 *   npm run db:reset          ← asks for confirmation
 *   npm run db:reset:yes      ← skips confirmation
 *
 * ⚠️  DESTRUCTIVE — all data will be permanently deleted.
 */
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

let prisma = new PrismaClient();

// ─── SQL splitter ───────────────────────────────────────────────────────────
/**
 * Split a SQL file into individual statements.
 * Handles:
 *  - Dollar-quoted bodies  ($$ ... $$)  which may contain semicolons
 *  - Line comments         (-- ...)
 *  - Single-quoted strings ('...')
 *  - Block comments        (/* ... *\/)
 */
function splitSql(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let i = 0;
    let inDollarQuote = false;
    let dollarTag = '';
    let inSingleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < sql.length) {
        const ch = sql[i];
        const rest = sql.slice(i);

        // ── Escape sequences inside single-quoted strings ──────────────────
        if (inSingleQuote) {
            if (ch === "'" && sql[i + 1] === "'") {
                current += "''";
                i += 2;
                continue;
            }
            if (ch === "'") {
                inSingleQuote = false;
            }
            current += ch;
            i++;
            continue;
        }

        // ── Block comment ───────────────────────────────────────────────────
        if (inBlockComment) {
            if (ch === '*' && sql[i + 1] === '/') {
                current += '*/';
                i += 2;
                inBlockComment = false;
            } else {
                current += ch;
                i++;
            }
            continue;
        }

        // ── Line comment ────────────────────────────────────────────────────
        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
                current += ch;
            } else {
                current += ch;
            }
            i++;
            continue;
        }

        // ── Dollar-quote ────────────────────────────────────────────────────
        if (inDollarQuote) {
            // Check for closing tag
            if (rest.startsWith(dollarTag)) {
                current += dollarTag;
                i += dollarTag.length;
                inDollarQuote = false;
                dollarTag = '';
            } else {
                current += ch;
                i++;
            }
            continue;
        }

        // ── Detect transitions ──────────────────────────────────────────────
        if (ch === '-' && sql[i + 1] === '-') {
            inLineComment = true;
            current += '--';
            i += 2;
            continue;
        }

        if (ch === '/' && sql[i + 1] === '*') {
            inBlockComment = true;
            current += '/*';
            i += 2;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            current += ch;
            i++;
            continue;
        }

        // Dollar-quote detection: $tag$ or $$
        if (ch === '$') {
            const tagMatch = rest.match(/^\$([A-Za-z_0-9]*)\$/);
            if (tagMatch) {
                const tag = tagMatch[0];
                inDollarQuote = true;
                dollarTag = tag;
                current += tag;
                i += tag.length;
                continue;
            }
        }

        // ── Statement boundary ──────────────────────────────────────────────
        if (ch === ';') {
            const stmt = current.trim();
            if (stmt) statements.push(stmt);
            current = '';
            i++;
            continue;
        }

        current += ch;
        i++;
    }

    const last = current.trim();
    if (last) statements.push(last);

    return statements.filter(s => {
        // drop pure-comment statements
        const stripped = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
        return stripped.length > 0;
    });
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function execSql(sql: string, params: any[] = []): Promise<void> {
    await prisma.$executeRawUnsafe(sql, ...params);
}

async function runMigrationFile(filePath: string): Promise<void> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const statements = splitSql(raw);
    for (const stmt of statements) {
        await execSql(stmt);
    }
}

function confirm(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
    const skipConfirm = process.argv.includes('--yes');

    console.log('\n🔴  Database Reset Script');
    console.log('   This will permanently delete ALL data and rebuild from migrations.\n');

    if (!skipConfirm) {
        const ok = await confirm('Are you sure? Type "y" to continue: ');
        if (!ok) {
            console.log('❌  Aborted.\n');
            process.exit(0);
        }
    }

    // ── Step 1: Drop everything ───────────────────────────────────────────
    console.log('⏳  Step 1/3 — Dropping all tables & objects...');

    const drops = [
        // Leaf tables first (no FK children)
        'DROP TABLE IF EXISTS audit_logs           CASCADE',
        'DROP TABLE IF EXISTS password_resets      CASCADE',
        'DROP TABLE IF EXISTS admin_invites        CASCADE',
        'DROP TABLE IF EXISTS route_checkpoints    CASCADE',
        'DROP TABLE IF EXISTS gps_flags            CASCADE',
        'DROP TABLE IF EXISTS "GPSEvent"           CASCADE',
        'DROP TABLE IF EXISTS gps_events           CASCADE',
        'DROP TABLE IF EXISTS completions          CASCADE',
        'DROP TABLE IF EXISTS "Completion"         CASCADE',
        'DROP TABLE IF EXISTS "RouteCheckpoint"    CASCADE',
        'DROP TABLE IF EXISTS "GPSFlag"            CASCADE',
        'DROP TABLE IF EXISTS badges               CASCADE',
        'DROP TABLE IF EXISTS "PrayerSession"      CASCADE',
        'DROP TABLE IF EXISTS prayer_sessions      CASCADE',
        'DROP TABLE IF EXISTS prayers              CASCADE',
        'DROP TABLE IF EXISTS "PrayerLocation"     CASCADE',
        'DROP TABLE IF EXISTS prayer_locations     CASCADE',
        'DROP TABLE IF EXISTS branches             CASCADE',
        'DROP TABLE IF EXISTS prayer_journals      CASCADE',
        'DROP TABLE IF EXISTS prayer_coverage      CASCADE',
        'DROP TABLE IF EXISTS participants         CASCADE',
        'DROP TABLE IF EXISTS gps_points           CASCADE',
        'DROP TABLE IF EXISTS prayer_walks         CASCADE',
        'DROP TABLE IF EXISTS streets              CASCADE',
        'DROP TABLE IF EXISTS "User"               CASCADE',
        'DROP TABLE IF EXISTS users                CASCADE',
        // Views
        'DROP VIEW IF EXISTS walk_statistics       CASCADE',
        'DROP VIEW IF EXISTS branch_coverage_stats CASCADE',
        // Functions
        'DROP FUNCTION IF EXISTS update_updated_at_column()              CASCADE',
        'DROP FUNCTION IF EXISTS calculate_route_distance()              CASCADE',
        'DROP FUNCTION IF EXISTS update_prayer_coverage_from_walk()      CASCADE',
    ];

    for (const stmt of drops) {
        await execSql(stmt);
    }

    console.log('   ✓ All tables, views and functions dropped\n');

    // ── Step 2: Prisma schema sync (db push) ──────────────────────────────
    console.log('⏳  Step 2/4 — Applying Prisma schema (db push)...');
    try {
        // Runs Prisma db push to create base tables.
        execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
        console.log('   ✓ Prisma schema base synced\n');
    } catch (err: any) {
        console.error('\n❌  Prisma push failed:\n', err.message || err);
        process.exit(1);
    }

    // ── Step 3: Run schema triggers + additive migrations ──────────────────
    console.log('⏳  Step 3/4 — Applying SQL triggers and manual migrations...');

    // Additive migrations 002–006
    const rootDir = process.cwd();
    const migrationsDir = path.resolve(rootDir, 'database/migrations');

    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql') && !f.startsWith('001_'))
        .sort();

    for (const file of migrationFiles) {
        const fullPath = path.join(migrationsDir, file);
        process.stdout.write(`   Running ${file}… `);
        try {
            await runMigrationFile(fullPath);
            console.log('✓');
        } catch (err: any) {
            console.error(`\n❌  Failed at ${file}:\n`, err.message || err);
            process.exit(1);
        }
    }

    console.log('');

    // ── Step 4: Seed ──────────────────────────────────────────────────────
    console.log('⏳  Step 4/4 — Skipping seeding (empty DB)...\n');

    console.log('✅  Database reset complete!');
    console.log(`   Migrations: ${migrationFiles.join(', ')}`);
    console.log('   Run:   npm run dev\n');
}

main()
    .catch(err => {
        console.error('\n❌  Reset failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
