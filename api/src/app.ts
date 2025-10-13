import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/auth';
import { env } from './config/env';
import { isOriginAllowed, parseAllowedOrigins } from './utils/cors';

export const app = new Hono();

// Parse allowed origins from environment variable
const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

// Configuration CORS
app.use('*', cors({
  origin: (origin) => {
    // Allow requests with no origin (e.g., mobile apps, curl)
    if (!origin) return null;
    
    return isOriginAllowed(origin, allowedOrigins) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.route('/api/v1', apiRouter);
app.route('/auth', authRouter);

app.get('/', (c) => c.json({ name: 'Top AI Ideas API', version: '0.1.0' }));
