import { Hono } from 'hono';
import { runTestSeed } from './test/seed.js';

export const testRouter = new Hono();

// POST /api/test/seed -> runs the test seed script
testRouter.post('/seed', async (c) => {
  try {
    const result = await runTestSeed();
    if (result.ok) {
      return c.json({ ok: true, stdout: result.stdout });
    } else {
      return c.json({ ok: false, stderr: result.stderr }, 500);
    }
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
