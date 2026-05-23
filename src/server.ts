import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
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

// Allowed origins for CORS
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true, // Allow all origins if CORS_ORIGINS is not configured (dev mode)
  credentials: true,
}));

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
app.use(express.json({ limit: '1mb' }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 signups per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res, next) => {
  logger.info('request_diag', { method: req.method, url: req.url, path: req.path });
  next();
});

// Apply rate limiting to auth routes
app.use('/auth/login', authLimiter);
app.use('/auth/signup', signupLimiter);
app.use('/auth/register', signupLimiter);
app.use('/auth/forgot-password', authLimiter);
app.use('/auth/reset-password', authLimiter);

app.use('/auth', authRoutes);
app.use('/branches', branchRoutes);
app.use('/locations', locationRoutes);
app.use('/walks', walkRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);
app.use('/search', searchRoutes);

app.use(errorHandler);

// Admin dashboard SPA — served at / after all API routes
app.use(express.static(path.join(process.cwd(), 'public', 'dashboard')));
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard', 'index.html'));
});

const PORT = process.env.PORT || 3001;

if (!process.env.VERCEL) {
  app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info('Server is running', { port: PORT });
  });
}

export default app;
