import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { prisma, createPoint } from './lib/db';
import { verifyToken } from './lib/auth';
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import walkRoutes from './routes/walks';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import { validateGPSUpdate } from './lib/gps';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Middleware
app.use(cors());
app.use(helmet());
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
      documentation: 'See PHASE2_SUMMARY.md'
    }
  });
});

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.use('/auth', authRoutes);
app.use('/locations', locationRoutes);
app.use('/walks', walkRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);

// WebSocket Handling
const clients = new Map<string, WebSocket>();

server.on('upgrade', (request, socket, head) => {
  const { pathname, query } = parse(request.url || '', true);

  if (pathname === '/ws') {
    const token = query.token as string;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const payload = verifyToken(token);
      if (!payload) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, payload.userId);
      });
    } catch (e) {
      console.error("WS Auth Error", e);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket, req: any, userId: string) => {
  console.log(`User connected: ${userId}`);
  clients.set(userId, ws);

  ws.on('message', async (message: any) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'LOCATION_UPDATE') {
        const { latitude, longitude, sessionId, speed, accuracy, isMock } = data.payload;

        if (latitude && longitude && sessionId) {
          try {
            await validateGPSUpdate(sessionId, userId, {
              latitude,
              longitude,
              speed,
              accuracy,
              isMock
            });
            ws.send(JSON.stringify({ type: 'ACK', status: 'validated' }));
          } catch (err) {
            console.error("Failed to validate GPS for session", sessionId, err);
          }
        }
      }
    } catch (error) {
      console.error('WS Message Error:', error);
    }
  });

  ws.on('close', () => {
    console.log(`User disconnected: ${userId}`);
    clients.delete(userId);
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3001;

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server ready at ws://0.0.0.0:${PORT}/ws`);
});
