import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/auth';

export const app = new Hono();

// Configuration CORS
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://ui:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/api/v1', apiRouter);
app.route('/auth', authRouter);

app.get('/', (c) => c.json({ name: 'Top AI Ideas API', version: '0.1.0' }));
