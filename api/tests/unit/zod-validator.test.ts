import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../src/utils/zod-validator';

describe('Validation response contract', () => {
  const schema = z.object({ name: z.string().min(1) });
  const app = new Hono()
    .post('/', zValidator('json', schema), (c) => c.json(c.req.valid('json')))
    .get('/', zValidator('query', schema), (c) => c.json(c.req.valid('query')));

  it('should preserve the previous 400 envelope when JSON validation fails', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":""}',
    });
    expect(response.status).toBe(400);
    const parsed = schema.safeParse({ name: '' });
    expect(parsed.success).toBe(false);
    expect(await response.json()).toEqual({
      success: false,
      error: { issues: parsed.error!.issues, name: 'ZodError' },
    });
  });

  it('should include issue paths when query validation fails', async () => {
    const response = await app.request('/');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: { name: 'ZodError', issues: [expect.objectContaining({ path: ['name'], code: 'invalid_type' })] },
    });
  });

  it('should pass valid JSON to the handler', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Acme"}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Acme' });
  });
});
