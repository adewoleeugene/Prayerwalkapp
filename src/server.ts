import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import walkRoutes from './routes/walks';
import branchRoutes from './routes/branches';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import searchRoutes from './routes/search';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './lib/logger';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://unpkg.com",
          "https://cdn.tailwindcss.com",
          "https://maps.googleapis.com",
          "https://maps.gstatic.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static('public'));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Charis Prayer Walk API',
    version: '1.0.0',
    endpoints: {
      auth: '/auth',
      locations: '/locations',
      walks: '/walks',
      users: '/users',
      documentation: 'See PHASE2_SUMMARY.md',
      deployment_at: '2026-02-26T18:31:00Z'
    }
  });
});

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res, next) => {
  logger.info('request_diag', { method: req.method, url: req.url, path: req.path });
  next();
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'admin-login.html'));
});

// New React Dashboard (Shadcn)
app.use('/v2', express.static(path.join(process.cwd(), 'public', 'dashboard')));
app.get('/v2/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard', 'index.html'));
});

app.get('/superadmin', (req, res) => {
  res.redirect('/admin');
});

app.use('/auth', authRoutes);
app.use('/branches', branchRoutes);
app.use('/locations', locationRoutes);
app.use('/walks', walkRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);
app.use('/search', searchRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 3001;

if (!process.env.VERCEL) {
  app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info('Server is running', { port: PORT });
  });
}

export default app;
