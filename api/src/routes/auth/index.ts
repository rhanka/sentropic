import { Hono } from 'hono';

export const authRouter = new Hono();

authRouter.get('/google/login', (c) => c.json({ message: 'Google login not implemented yet' }, 501));
authRouter.get('/google/callback', (c) => c.json({ message: 'Google callback not implemented yet' }, 501));
authRouter.get('/linkedin/login', (c) => c.json({ message: 'LinkedIn login not implemented yet' }, 501));
authRouter.get('/linkedin/callback', (c) => c.json({ message: 'LinkedIn callback not implemented yet' }, 501));
