/**
 * Thin Express app export used exclusively by the E2E test suite.
 * Mirrors the route setup in server.ts without the WebSocket layer
 * or server.listen(), so supertest can bind its own ephemeral port.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import walkRoutes from './routes/walks';
import branchRoutes from './routes/branches';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import searchRoutes from './routes/search';

dotenv.config();

export function buildApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.get('/health', (_req, res) => res.json({ status: 'ok' }));

    app.use('/auth', authRoutes);
    app.use('/branches', branchRoutes);
    app.use('/locations', locationRoutes);
    app.use('/walks', walkRoutes);
    app.use('/users', userRoutes);
    app.use('/admin', adminRoutes);
    app.use('/search', searchRoutes);

    // Generic error handler
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        console.error('[test-app error]', err);
        res.status(500).json({ error: err.message || 'internal_server_error' });
    });

    return app;
}
