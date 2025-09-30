import { Hono } from 'hono';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/auth';

export const app = new Hono();

app.route('/api/v1', apiRouter);
app.route('/auth', authRouter);

app.get('/', (c) => c.json({ name: 'Top AI Ideas API', version: '0.1.0' }));
